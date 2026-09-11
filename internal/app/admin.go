package app

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
	"time"
)

func acquireLease(ctx context.Context, db *pgxpool.Pool) (*pgxpool.Conn, error) {
	conn, e := db.Acquire(ctx)
	if e != nil {
		return nil, e
	}
	var ok bool
	e = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(74632612)").Scan(&ok)
	if e != nil || !ok {
		conn.Release()
		return nil, errors.New("another Remoter instance or maintenance operation owns this database")
	}
	return conn, nil
}
func releaseLease(conn *pgxpool.Conn) {
	if conn == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, e := conn.Exec(ctx, "SELECT pg_advisory_unlock(74632612)"); e != nil {
		conn.Conn().Close(ctx)
	}
	conn.Release()
}
func RotateKey(ctx context.Context, c Config, newKey []byte) error {
	old, e := NewVault(c.Key)
	if e != nil {
		return e
	}
	next, e := NewVault(newKey)
	if e != nil {
		return e
	}
	db, e := pgxpool.New(ctx, c.DatabaseURL)
	if e != nil {
		return e
	}
	defer db.Close()
	lease, e := acquireLease(ctx, db)
	if e != nil {
		return e
	}
	defer releaseLease(lease)
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	type item struct{ id, user, data, secret string }
	specs := []struct {
		table, id string
		secret    bool
		aad       func(item) (string, string)
	}{{"hosts", "id", true, func(v item) (string, string) {
		return v.user + ":" + v.id + ":host", v.user + ":" + v.id + ":credential"
	}}, {"ai_settings", "user_id", true, func(v item) (string, string) { return v.user + ":ai", v.user + ":ai-key" }}, {"ai_tasks", "id", false, func(v item) (string, string) { return v.user + ":" + v.id + ":task", "" }}}
	for _, spec := range specs {
		secretCol := "''"
		if spec.secret {
			secretCol = "secret"
			if spec.table == "hosts" {
				secretCol = "credential"
			}
		}
		rows, e := tx.Query(ctx, "SELECT "+spec.id+",user_id,data,"+secretCol+" FROM "+spec.table+" FOR UPDATE")
		if e != nil {
			return e
		}
		items := []item{}
		for rows.Next() {
			var v item
			if e = rows.Scan(&v.id, &v.user, &v.data, &v.secret); e != nil {
				rows.Close()
				return e
			}
			items = append(items, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, v := range items {
			aad, secretAAD := spec.aad(v)
			plain, e := old.Open(v.data, aad)
			if e != nil {
				return errors.New("existing master key cannot decrypt all records; rotation rolled back")
			}
			encrypted, e := next.Seal(plain, aad)
			if e != nil {
				return e
			}
			secret := ""
			if v.secret != "" {
				plain, e = old.Open(v.secret, secretAAD)
				if e != nil {
					return errors.New("credential decrypt failed; rotation rolled back")
				}
				secret, e = next.Seal(plain, secretAAD)
				if e != nil {
					return e
				}
			}
			if spec.secret {
				_, e = tx.Exec(ctx, "UPDATE "+spec.table+" SET data=$1,"+secretCol+"=$2 WHERE "+spec.id+"=$3", encrypted, secret, v.id)
			} else {
				_, e = tx.Exec(ctx, "UPDATE "+spec.table+" SET data=$1 WHERE "+spec.id+"=$2", encrypted, v.id)
			}
			if e != nil {
				return e
			}
		}
	}
	if e = rotateMonitorKey(ctx, tx, old, next); e != nil {
		return e
	}
	check, e := next.Seal("remoter-vault-v1", "vault-key-check")
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, "UPDATE vault_metadata SET key_check=$1 WHERE id=1", check); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func ResetPassword(ctx context.Context, c Config, email, password string) error {
	if len(password) < 12 || len(password) > 256 {
		return errors.New("password must be 12–256 bytes")
	}
	db, e := pgxpool.New(ctx, c.DatabaseURL)
	if e != nil {
		return e
	}
	defer db.Close()
	tx, e := db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var id string
	e = tx.QueryRow(ctx, "UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id", passwordHash(password), strings.ToLower(strings.TrimSpace(email))).Scan(&id)
	if e != nil {
		return errors.New("account not found or update failed")
	}
	if _, e = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", id); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
