package app

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
)

// Rotate all monitoring ciphertext in bounded batches under the existing vault
// maintenance lease. The cursor snapshot prevents updated ctids being revisited.
func rotateMonitorKey(ctx context.Context, tx pgx.Tx, old, next *Vault) error {
	var exists bool
	if e := tx.QueryRow(ctx, "SELECT to_regclass('agent_bindings') IS NOT NULL").Scan(&exists); e != nil {
		return e
	}
	if !exists {
		return nil
	}
	specs := []struct {
		table, selectSQL string
		columns          []string
		aad              []string
	}{
		{"agent_bindings", "SELECT b.ctid::text,b.user_id,b.host_id,b.config,b.latest,b.pending_secret FROM agent_bindings b", []string{"config", "latest", "pending_secret"}, []string{"agent-config", "agent-latest", "agent-pending-token"}},
		{"agent_install_jobs", "SELECT b.ctid::text,b.user_id,b.host_id,b.credential,'agent-job:'||b.id FROM agent_install_jobs b", []string{"credential"}, nil},
		{"metric_rollups", "SELECT b.ctid::text,h.user_id,b.host_id,b.data,'rollup:'||b.step||':'||extract(epoch FROM b.bucket)::bigint FROM metric_rollups b JOIN hosts h ON h.id=b.host_id", []string{"data"}, nil},
		{"monitor_traffic", "SELECT b.ctid::text,h.user_id,b.host_id,b.data,'traffic:'||b.period||':'||extract(epoch FROM b.start_at)::bigint FROM monitor_traffic b JOIN hosts h ON h.id=b.host_id", []string{"data"}, nil},
		{"monitor_events", "SELECT b.ctid::text,b.user_id,b.host_id,b.data,'event:'||b.id FROM monitor_events b", []string{"data"}, nil},
		{"alert_rules", "SELECT b.ctid::text,b.user_id,b.host_id,b.config,b.state FROM alert_rules b", []string{"config", "state"}, []string{"alert-config", "alert-state"}},
	}
	for _, spec := range specs {
		if _, e := tx.Exec(ctx, "DECLARE monitor_rotation NO SCROLL CURSOR FOR "+spec.selectSQL); e != nil {
			return e
		}
		for {
			rows, e := tx.Query(ctx, "FETCH 200 FROM monitor_rotation", pgx.QueryExecModeExec)
			if e != nil {
				return e
			}
			items := [][]string{}
			for rows.Next() {
				count := 3 + len(spec.columns)
				if spec.aad == nil {
					count++
				}
				values := make([]string, count)
				ptrs := make([]any, count)
				for i := range values {
					ptrs[i] = &values[i]
				}
				if e = rows.Scan(ptrs...); e != nil {
					break
				}
				items = append(items, values)
			}
			if e == nil {
				e = rows.Err()
			}
			rows.Close()
			if e != nil {
				return e
			}
			if len(items) == 0 {
				break
			}
			for _, item := range items {
				for i, col := range spec.columns {
					raw := item[3+i]
					if raw == "" {
						continue
					}
					kind := ""
					if spec.aad == nil {
						kind = item[len(item)-1]
					} else {
						kind = spec.aad[i]
					}
					aad := item[1] + ":" + item[2] + ":" + kind
					plain, e := old.Open(raw, aad)
					if e != nil {
						return e
					}
					cipher, e := next.Seal(plain, aad)
					if e != nil {
						return e
					}
					var newCTID string
					e = tx.QueryRow(ctx, fmt.Sprintf("UPDATE %s SET %s=$1 WHERE ctid=$2::tid RETURNING ctid::text", spec.table, col), cipher, item[0]).Scan(&newCTID)
					if e != nil {
						return e
					}
					item[0] = newCTID
				}
			}
		}
		if _, e := tx.Exec(ctx, "CLOSE monitor_rotation"); e != nil {
			return e
		}
	}
	return nil
}
