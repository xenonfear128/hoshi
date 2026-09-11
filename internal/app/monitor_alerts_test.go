package app

import (
	"testing"
	"time"
)

func TestSustainedAlertRecoveryCooldownAndGaps(t *testing.T) {
	now := time.Now()
	st := alertState{}
	step := func(at int, known, high, low bool) string {
		var change string
		st, change = transitionAlert(st, now.Add(time.Duration(at)*time.Second), known, high, low, 10*time.Second, 5*time.Second, 30*time.Second)
		return change
	}
	if step(0, true, true, false) != "" || step(5, true, true, false) != "" || step(10, true, true, false) != "trigger" {
		t.Fatal("sustained trigger failed")
	}
	if step(15, false, false, true) != "" || !st.Active {
		t.Fatal("missing data recovered active alert")
	}
	if step(20, true, false, true) != "" || step(25, true, false, true) != "recovery" {
		t.Fatal("recovery dwell failed")
	}
	if step(30, true, true, false) != "" || step(40, true, true, false) != "" || step(50, true, true, false) != "" || step(55, true, true, false) != "trigger" {
		t.Fatal("cooldown failed")
	}
	st = alertState{}
	step(0, true, true, false)
	if step(30, true, true, false) != "" {
		t.Fatal("collection gap counted as sustained observation")
	}
}
