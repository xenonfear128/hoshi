package app

import "regexp"

var privateKeyPattern = regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----`)
var partialPrivateKeyPattern = regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*$`)
var secretPattern = regexp.MustCompile(`(?i)(password|passwd|api[_-]?key|authorization|access[_-]?token|secret)(\s*[:=]\s*)([^\s,;]+)`)
var bearerPattern = regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._~+/=-]+`)

func redact(s string) string {
	s = bearerPattern.ReplaceAllString(s, "Bearer [REDACTED]")
	s = privateKeyPattern.ReplaceAllString(s, "[PRIVATE KEY REDACTED]")
	s = partialPrivateKeyPattern.ReplaceAllString(s, "[PRIVATE KEY REDACTED]")
	s = secretPattern.ReplaceAllString(s, "${1}${2}[REDACTED]")
	return bearerPattern.ReplaceAllString(s, "Bearer [REDACTED]")
}
