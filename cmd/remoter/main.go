package main

import (
	"context"
	"encoding/base64"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"remoter/internal/app"
	"strings"
	"syscall"
	"time"
)

func main() {
	c, e := app.ConfigFromEnv()
	if e != nil {
		slog.Error("invalid configuration", "error", e)
		os.Exit(1)
	}
	if len(os.Args) > 1 {
		var err error
		switch os.Args[1] {
		case "rotate-key":
			if len(os.Args) != 3 {
				slog.Error("usage: remoter rotate-key NEW_KEY_FILE")
				os.Exit(1)
			}
			b, e := os.ReadFile(os.Args[2])
			if e != nil {
				err = e
			} else {
				key, e := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b)))
				if e != nil || len(key) != 32 {
					slog.Error("new key must encode 32 bytes")
					os.Exit(1)
				}
				err = app.RotateKey(context.Background(), c, key)
			}
		case "reset-password":
			if len(os.Args) != 4 {
				slog.Error("usage: remoter reset-password EMAIL PASSWORD_FILE")
				os.Exit(1)
			}
			b, e := os.ReadFile(os.Args[3])
			if e != nil {
				err = e
			} else {
				err = app.ResetPassword(context.Background(), c, os.Args[2], strings.TrimRight(string(b), "\r\n"))
			}
		default:
			slog.Error("unknown command")
			os.Exit(1)
		}
		if err != nil {
			slog.Error("maintenance failed", "error", err)
			os.Exit(1)
		}
		slog.Info("maintenance completed")
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	s, e := app.New(ctx, c)
	if e != nil {
		slog.Error("startup failed", "error", e)
		os.Exit(1)
	}
	defer s.Close()
	h := &http.Server{Addr: c.Address, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		slog.Info("remoter listening", "address", c.Address)
		if e := h.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			slog.Error("HTTP server stopped", "error", e)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	h.Shutdown(shutdown)
}
