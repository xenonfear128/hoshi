package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"golang.org/x/crypto/argon2"
	"strings"
)

type Vault struct{ aead cipher.AEAD }

func NewVault(key []byte) (*Vault, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	a, e := cipher.NewGCM(b)
	return &Vault{a}, e
}
func (v *Vault) Seal(plain, aad string) (string, error) {
	n := make([]byte, v.aead.NonceSize())
	if _, e := rand.Read(n); e != nil {
		return "", e
	}
	return "v1:" + base64.StdEncoding.EncodeToString(v.aead.Seal(n, n, []byte(plain), []byte(aad))), nil
}
func (v *Vault) Open(data, aad string) (string, error) {
	if !strings.HasPrefix(data, "v1:") {
		return "", errors.New("unknown key version")
	}
	b, e := base64.StdEncoding.DecodeString(data[3:])
	if e != nil || len(b) < v.aead.NonceSize() {
		return "", errors.New("invalid ciphertext")
	}
	n := v.aead.NonceSize()
	p, e := v.aead.Open(nil, b[:n], b[n:], []byte(aad))
	return string(p), e
}
func token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func passwordHash(p string) string {
	s := make([]byte, 16)
	if _, e := rand.Read(s); e != nil {
		panic(e)
	}
	h := argon2.IDKey([]byte(p), s, 2, 64*1024, 2, 32)
	return fmt.Sprintf("%s.%s", base64.RawStdEncoding.EncodeToString(s), base64.RawStdEncoding.EncodeToString(h))
}
func passwordMatch(p, h string) bool {
	parts := strings.Split(h, ".")
	if len(parts) != 2 {
		return false
	}
	s, e := base64.RawStdEncoding.DecodeString(parts[0])
	if e != nil || len(s) != 16 {
		return false
	}
	want, e := base64.RawStdEncoding.DecodeString(parts[1])
	if e != nil || len(want) != 32 {
		return false
	}
	got := argon2.IDKey([]byte(p), s, 2, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(got, want) == 1
}
