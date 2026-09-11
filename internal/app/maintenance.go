package app

import (
	"context"
	"log/slog"
	"time"
)

// Single-instance recovery: never rerun interrupted SSH commands. Unknown provider
// usage is absorbed by the operator; reservations are refunded on restart.
func (s *Server) recoverInterrupted(ctx context.Context) error {
	tx, e := s.db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `UPDATE credits c SET balance=c.balance+x.refund FROM (SELECT user_id,sum(reserved) AS refund FROM ai_usage WHERE status='pending' AND source='subscription' GROUP BY user_id) x WHERE c.user_id=x.user_id`)
	if e == nil {
		_, e = tx.Exec(ctx, "UPDATE ai_usage SET status='interrupted' WHERE status='pending'")
	}
	if e == nil {
		_, e = tx.Exec(ctx, "UPDATE ai_tasks SET status='interrupted',updated_at=now() WHERE status='running'")
	}
	if e == nil {
		_, e = tx.Exec(ctx, "UPDATE agent_install_jobs SET status='failed',message='server restarted during remote operation; inspect agent before retry',credential='',updated_at=now() WHERE status='running'")
	}
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Server) maintenance(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		clean, cancel := context.WithTimeout(ctx, 20*time.Second)
		_, e := s.db.Exec(clean, "DELETE FROM sessions WHERE expires_at<now()")
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM ai_tasks WHERE status<>'running' AND updated_at < now() - make_interval(days => $1)", s.retentionDays())
		}
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM metric_samples WHERE received_at < now() - interval '2 hours'")
		}
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM metric_rollups WHERE (step=10 AND bucket < now() - interval '24 hours') OR (step=60 AND bucket < now() - interval '30 days') OR (step=3600 AND bucket < now() - interval '180 days')")
		}
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM monitor_traffic WHERE start_at < now() - interval '180 days'")
		}
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM agent_registration_tokens WHERE expires_at<now()")
		}
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM monitor_events WHERE created_at<now()-interval '180 days'")
		}
		if e == nil {
			_, e = s.db.Exec(clean, "DELETE FROM agent_install_jobs WHERE status IN ('failed','complete') AND updated_at<now()-interval '30 days'")
		}
		s.mu.Lock()
		for id, ring := range s.agentCache {
			if len(ring) == 0 || ring[len(ring)-1].ReceivedAt.Before(time.Now().Add(-10*time.Minute)) {
				delete(s.agentCache, id)
			}
		}
		s.mu.Unlock()
		cancel()
		if e != nil && ctx.Err() == nil {
			slog.Error("maintenance failed", "error", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Server) retentionDays() int {
	if s.cfg.TaskRetentionDays < 1 {
		return 30
	}
	return s.cfg.TaskRetentionDays
}
