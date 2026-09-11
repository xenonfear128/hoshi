package app

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"remoter/internal/agent"
	"remoter/internal/agentproto"
)

//go:embed agent-install.sh
var installTemplate string

type AgentJob struct {
	ID        string    `json:"id"`
	HostID    string    `json:"hostID"`
	Kind      string    `json:"kind"`
	Status    string    `json:"status"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type installCredential struct {
	Credential  *Credential `json:"credential,omitempty"`
	Sudo        bool        `json:"sudo"`
	Fingerprint string      `json:"fingerprint"`
}

func (s *Server) artifactPath(arch string) string {
	dir := s.cfg.AgentDir
	if dir == "" {
		dir = "agents"
	}
	return filepath.Join(dir, "hoshi-agent-linux-"+arch)
}
func (s *Server) installScript() (string, error) {
	script := strings.ReplaceAll(installTemplate, "__ORIGIN__", s.cfg.Origin)
	for _, arch := range []string{"amd64", "arm64"} {
		file, e := os.Open(s.artifactPath(arch))
		if e != nil {
			return "", errors.New("agent release artifacts are unavailable")
		}
		h := sha256.New()
		_, e = io.Copy(h, file)
		file.Close()
		if e != nil {
			return "", e
		}
		script = strings.ReplaceAll(script, "__"+strings.ToUpper(arch)+"_SHA__", hex.EncodeToString(h.Sum(nil)))
	}
	return script, nil
}
func (s *Server) agentArtifact(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "install.sh" {
		script, e := s.installScript()
		if e != nil {
			fail(w, 503, e.Error())
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		io.WriteString(w, script)
		return
	}
	for _, arch := range []string{"amd64", "arm64"} {
		if name == "hoshi-agent-linux-"+arch {
			if _, e := os.Stat(s.artifactPath(arch)); e != nil {
				fail(w, 503, "agent artifact unavailable")
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			http.ServeFile(w, r, s.artifactPath(arch))
			return
		}
	}
	fail(w, 404, "artifact not found")
}
func (s *Server) agentJobs(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	rows, e := s.db.Query(r.Context(), "SELECT id,host_id,kind,status,message,created_at,updated_at FROM agent_install_jobs WHERE host_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30", id, uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []AgentJob{}
	for rows.Next() {
		var j AgentJob
		if e = rows.Scan(&j.ID, &j.HostID, &j.Kind, &j.Status, &j.Message, &j.CreatedAt, &j.UpdatedAt); e != nil {
			break
		}
		out = append(out, j)
	}
	if e == nil {
		e = rows.Err()
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, out)
}
func (s *Server) agentJobCreate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h, _, e := s.loadHost(r, id)
	if e != nil {
		fail(w, 404, "host not found")
		return
	}
	var in struct {
		Kind       string      `json:"kind"`
		Credential *Credential `json:"credential,omitempty"`
		Sudo       bool        `json:"sudo"`
	}
	if !decodeLimit(w, r, &in, 64<<10) {
		return
	}
	if in.Kind != "install" && in.Kind != "upgrade" && in.Kind != "uninstall" {
		fail(w, 400, "invalid agent operation")
		return
	}
	if h.Fingerprint == "" {
		fail(w, 409, "verify host fingerprint first")
		return
	}
	if !s.allow("agent-jobs:"+uid(r), 20, time.Minute) {
		fail(w, 429, "too many agent operations")
		return
	}
	if !strings.HasPrefix(s.cfg.Origin, "https://") {
		fail(w, 400, "agent installation requires a public HTTPS origin")
		return
	}
	if _, e = s.installScript(); e != nil {
		fail(w, 503, e.Error())
		return
	}
	job := token()
	credential, e := s.sealMonitor(uid(r), id, "agent-job:"+job, installCredential{Credential: in.Credential, Sudo: in.Sudo, Fingerprint: h.Fingerprint})
	if e != nil {
		s.dbError(w, e)
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	b, e := scanBinding(tx.QueryRow(r.Context(), "SELECT "+bindingColumns+" FROM agent_bindings WHERE host_id=$1 AND user_id=$2 FOR UPDATE", id, uid(r)))
	if e != nil {
		fail(w, 404, "agent binding not found")
		return
	}
	if in.Kind == "install" && (!b.Enabled || b.Digest != "") {
		fail(w, 409, "revoke the existing credential before rebinding")
		return
	}
	if in.Kind == "upgrade" && (!b.Enabled || b.Digest == "") {
		fail(w, 409, "a registered agent is required for upgrade")
		return
	}
	tag, e := tx.Exec(r.Context(), `INSERT INTO agent_install_jobs(id,user_id,host_id,kind,credential) VALUES($1,$2,$3,$4,$5) ON CONFLICT(host_id) WHERE status IN ('pending','running','waiting') DO NOTHING`, job, uid(r), id, in.Kind, credential)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		var existingKind string
		if e = tx.QueryRow(r.Context(), "SELECT kind FROM agent_install_jobs WHERE host_id=$1 AND status IN ('pending','running','waiting')", id).Scan(&existingKind); e != nil {
			s.dbError(w, e)
			return
		}
		if existingKind != in.Kind {
			fail(w, 409, "another agent operation is in progress")
			return
		}
		_ = tx.Rollback(r.Context())
		s.agentJobs(w, r)
		return
	}
	// Uninstall revokes immediately, even if SSH later fails.
	if in.Kind == "uninstall" {
		_, e = tx.Exec(r.Context(), `UPDATE agent_bindings SET enabled=false,report_digest='',pending_digest='',pending_secret='',status='disabled',last_current=NULL WHERE id=$1`, b.ID)
		if e == nil {
			_, e = tx.Exec(r.Context(), "DELETE FROM agent_registration_tokens WHERE binding_id=$1", b.ID)
		}
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.agentJobs(w, r)
}
func (s *Server) updateJob(ctx context.Context, id, status, message string) error {
	_, e := s.db.Exec(ctx, `UPDATE agent_install_jobs SET status=$2,message=$3,updated_at=now(),credential=CASE WHEN $2 IN ('complete','failed') THEN '' ELSE credential END WHERE id=$1`, id, status, message)
	return e
}
func (s *Server) agentJobWorker(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		_, _ = s.db.Exec(ctx, "UPDATE agent_install_jobs SET status='failed',message='no authenticated report within five minutes; inspect service and endpoint connectivity',credential='',updated_at=now() WHERE status='waiting' AND updated_at<now()-interval '5 minutes'")
		var job AgentJob
		var owner, encrypted string
		e := s.db.QueryRow(ctx, `UPDATE agent_install_jobs SET status='running',updated_at=now() WHERE id=(SELECT id FROM agent_install_jobs WHERE status='pending' ORDER BY created_at LIMIT 1) RETURNING id,user_id,host_id,kind,credential,created_at`).Scan(&job.ID, &owner, &job.HostID, &job.Kind, &encrypted, &job.CreatedAt)
		if e == nil {
			limit, cancel := context.WithTimeout(ctx, 3*time.Minute)
			s.mu.Lock()
			s.jobCancels[job.HostID] = cancel
			s.mu.Unlock()
			e = s.runAgentJob(limit, job, owner, encrypted)
			cancel()
			s.mu.Lock()
			delete(s.jobCancels, job.HostID)
			s.mu.Unlock()
			if e != nil && ctx.Err() == nil {
				_ = s.updateJob(ctx, job.ID, "failed", e.Error())
				if job.Kind == "install" {
					_, _ = s.db.Exec(ctx, "UPDATE agent_bindings SET status='failed' WHERE host_id=$1 AND last_current IS NULL", job.HostID)
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func sshScript(ctx context.Context, client *ssh.Client, command string, input io.Reader) (string, error) {
	sess, e := client.NewSession()
	if e != nil {
		return "", e
	}
	defer sess.Close()
	out := &limitedBuffer{limit: 16 << 10}
	sess.Stdout = out
	sess.Stderr = out
	sess.Stdin = input
	done := make(chan error, 1)
	go func() { done <- sess.Run(command) }()
	select {
	case e = <-done:
		return out.String(), e
	case <-ctx.Done():
		client.Close()
		<-done
		return "", ctx.Err()
	}
}
func (s *Server) runAgentJob(ctx context.Context, j AgentJob, owner, encrypted string) error {
	var input installCredential
	if e := s.openMonitor(owner, j.HostID, "agent-job:"+j.ID, encrypted, &input); e != nil {
		return errors.New("cannot open installation credential")
	}
	req, _ := http.NewRequestWithContext(context.WithValue(ctx, userKey{}, owner), http.MethodGet, "http://localhost", nil)
	h, credential, e := s.loadHost(req, j.HostID)
	if e != nil {
		return errors.New("host is unavailable")
	}
	if h.Fingerprint != input.Fingerprint {
		return errors.New("host fingerprint changed; verify and retry")
	}
	if input.Credential != nil {
		credential = *input.Credential
	}
	_ = s.updateJob(ctx, j.ID, "running", "checking SSH fingerprint, platform and permissions")
	client, _, e := s.dial(ctx, h, credential, false)
	if e != nil {
		return e
	}
	defer client.Close()
	stop := context.AfterFunc(ctx, func() { client.Close() })
	defer stop()
	preflight := "uname -s; uname -m; id -u; test -d /run/systemd/system && command -v systemctl"
	output, e := sshScript(ctx, client, preflight, nil)
	if e != nil {
		return errors.New("automatic installation requires Linux and systemd; use manual installation")
	}
	fields := strings.Fields(output)
	if len(fields) < 4 || fields[0] != "Linux" {
		return errors.New("unsupported platform; Linux systemd is required")
	}
	arch := ""
	if fields[1] == "x86_64" {
		arch = "amd64"
	}
	if fields[1] == "aarch64" || fields[1] == "arm64" {
		arch = "arm64"
	}
	if arch == "" {
		return errors.New("automatic installation supports amd64 and arm64")
	}
	prefix := ""
	if fields[2] != "0" {
		if !input.Sudo {
			return errors.New("system installation needs explicitly authorized sudo or manual installation")
		}
		if _, e = sshScript(ctx, client, "sudo -n true", nil); e != nil {
			return errors.New("passwordless sudo unavailable; use manual installation")
		}
		prefix = "sudo -n "
	}
	// A validated public certificate is mandatory, even behind a self-signed origin.
	if j.Kind != "uninstall" {
		if _, e = sshScript(ctx, client, "curl --fail --silent --show-error --max-time 15 --proto '=https' "+shellQuote(s.cfg.Origin+"/healthz")+" >/dev/null", nil); e != nil {
			return errors.New("public monitoring HTTPS endpoint unreachable from target")
		}
	}
	script, e := s.installScript()
	if e != nil {
		return e
	}
	dir, e := sshScript(ctx, client, "umask 077; mktemp -d /tmp/hoshi-agent.XXXXXXXX", nil)
	dir = strings.TrimSpace(dir)
	if e != nil || !strings.HasPrefix(dir, "/tmp/hoshi-agent.") || strings.ContainsAny(dir, "\n\r \t'\"") {
		return errors.New("cannot create private installation directory")
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = sshScript(cleanup, client, "rm -rf -- "+shellQuote(dir), nil)
	}()
	files, e := sftp.NewClient(client)
	if e != nil {
		return errors.New("SFTP is unavailable")
	}
	defer files.Close()
	put := func(name string, reader io.Reader, mode os.FileMode) error {
		f, e := files.OpenFile(dir+"/"+name, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if e != nil {
			return e
		}
		if e = f.Chmod(mode); e == nil {
			_, e = io.Copy(f, reader)
		}
		closeErr := f.Close()
		if e == nil {
			e = closeErr
		}
		return e
	}
	if e = put("install.sh", strings.NewReader(script), 0700); e != nil {
		return errors.New("cannot upload installer")
	}
	if j.Kind != "uninstall" {
		artifact, e := os.Open(s.artifactPath(arch))
		if e != nil {
			return e
		}
		e = put("hoshi-agent-linux-"+arch, artifact, 0700)
		artifact.Close()
		if e != nil {
			return errors.New("cannot upload verified agent release")
		}
	}
	if j.Kind == "install" {
		secret := token()
		tx, e := s.db.Begin(ctx)
		if e != nil {
			return e
		}
		defer tx.Rollback(ctx)
		var binding string
		e = tx.QueryRow(ctx, "SELECT id FROM agent_bindings WHERE host_id=$1 AND user_id=$2 AND enabled=true AND report_digest='' FOR UPDATE", j.HostID, owner).Scan(&binding)
		if e != nil {
			return errors.New("binding changed during installation")
		}
		_, e = tx.Exec(ctx, "DELETE FROM agent_registration_tokens WHERE binding_id=$1", binding)
		if e == nil {
			_, e = tx.Exec(ctx, "INSERT INTO agent_registration_tokens(digest,binding_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", digest(secret), binding)
		}
		if e == nil {
			e = tx.Commit(ctx)
		}
		if e != nil {
			return e
		}
		config := agent.Config{ServerURL: s.cfg.Origin, RegistrationToken: secret}
		if e = put("config.json", strings.NewReader(string(jsonBytes(config))), 0600); e != nil {
			return errors.New("cannot upload private agent configuration")
		}
	}
	_ = s.updateJob(ctx, j.ID, "running", "installing service and verifying release checksum")
	var previousRaw string
	if e = s.db.QueryRow(ctx, "SELECT latest FROM agent_bindings WHERE host_id=$1", j.HostID).Scan(&previousRaw); e != nil {
		return e
	}
	var previous MonitorLatest
	if e = s.openMonitor(owner, j.HostID, "agent-latest", previousRaw, &previous); e != nil {
		return e
	}
	previousSession := ""
	if previous.Sample != nil {
		previousSession = previous.Sample.SessionID
	}
	started := time.Now().UTC()
	_, e = s.db.Exec(ctx, "UPDATE agent_install_jobs SET expected_version=$2,previous_session=$3,report_after=$4 WHERE id=$1", j.ID, agentproto.Version, previousSession, started)
	if e != nil {
		return e
	}
	if _, e = sshScript(ctx, client, prefix+"sh "+shellQuote(dir+"/install.sh")+" "+j.Kind, nil); e != nil {
		return errors.New("remote service operation failed; inspect existing installation and systemd status before retry")
	}
	if j.Kind == "uninstall" {
		return s.updateJob(ctx, j.ID, "complete", "remote agent service and files removed")
	}
	// A report can race the final systemctl reply. Check its receipt before waiting.
	var seen *time.Time
	var raw string
	e = s.db.QueryRow(ctx, "SELECT last_current,latest FROM agent_bindings WHERE host_id=$1", j.HostID).Scan(&seen, &raw)
	if e != nil {
		return e
	}
	var current MonitorLatest
	if e = s.openMonitor(owner, j.HostID, "agent-latest", raw, &current); e != nil {
		return e
	}
	if seen != nil && seen.After(started) && time.Since(*seen) < 15*time.Second && current.Sample != nil && current.Sample.Version == agentproto.Version && current.Sample.SessionID != previousSession && current.Sample.SampledAt.After(started) {
		return s.updateJob(ctx, j.ID, "complete", "authenticated report received")
	}
	return s.updateJob(ctx, j.ID, "waiting", "service started; awaiting first authenticated report")
}
func shellQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", "'\\''") + "'" }
