package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"remoter/internal/agent"
	"remoter/internal/agentproto"
	"syscall"
)

func main() {
	path := flag.String("config", "/var/lib/hoshi-agent/config.json", "private configuration file")
	version := flag.Bool("version", false, "print version")
	once := flag.Bool("sample", false, "collect a diagnostic sample without credentials")
	flag.Parse()
	if *version {
		fmt.Println(agentproto.Version)
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *once {
		s := agent.NewCollector(agentproto.Version).Sample(ctx, agentproto.DefaultSettings())
		fmt.Printf("OS=%s arch=%s cores=%d interfaces=%d disks=%d GPU=%s\n", s.OS, s.Arch, s.Cores, len(s.Network), len(s.Disks), s.Capabilities["gpu"])
		return
	}
	cfg, e := agent.ReadConfig(*path)
	if e == nil {
		e = agent.New(cfg, *path).Run(ctx)
	}
	if e != nil && ctx.Err() == nil {
		slog.Error("agent stopped", "error", e)
		os.Exit(1)
	}
}
