package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/authplane/authserver/internal/observability"
	"github.com/authplane/authserver/internal/ports/output"
)

var _ output.AdminSessionStore = (*AdminSessionStore)(nil)

// AdminSessionStore implements output.AdminSessionStore using PostgreSQL.
type AdminSessionStore struct {
	pool    *pgxpool.Pool
	logger  *slog.Logger
	tracer  trace.Tracer
	metrics *observability.Metrics
}

// Create persists an admin session record.
func (s *AdminSessionStore) Create(ctx context.Context, record output.AdminSessionRecord) error {
	ctx, span := s.tracer.Start(ctx, "Postgres.AdminSessionCreate")
	defer span.End()
	start := time.Now()

	_, err := dbOrTx(ctx, s.pool).Exec(ctx,
		`INSERT INTO admin_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		record.TokenHash, record.UserID, toUTC(record.ExpiresAt),
	)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("create admin session: %w", err)
	}
	if s.metrics != nil && s.metrics.DBOperationDuration != nil {
		s.metrics.DBOperationDuration.Record(ctx, time.Since(start).Seconds(), dbAttrs("admin_session_create"))
	}
	return nil
}

// Get returns an admin session record, or nil if it does not exist.
func (s *AdminSessionStore) Get(ctx context.Context, tokenHash string) (*output.AdminSessionRecord, error) {
	ctx, span := s.tracer.Start(ctx, "Postgres.AdminSessionGet")
	defer span.End()
	start := time.Now()

	record := &output.AdminSessionRecord{TokenHash: tokenHash}
	err := dbOrTx(ctx, s.pool).QueryRow(ctx,
		`SELECT user_id, expires_at FROM admin_sessions WHERE token_hash = $1`, tokenHash,
	).Scan(&record.UserID, &record.ExpiresAt)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("get admin session: %w", err)
	}
	record.ExpiresAt = toUTC(record.ExpiresAt)
	if s.metrics != nil && s.metrics.DBOperationDuration != nil {
		s.metrics.DBOperationDuration.Record(ctx, time.Since(start).Seconds(), dbAttrs("admin_session_get"))
	}
	return record, nil
}

// Delete revokes an admin session record. It succeeds if the record is absent.
func (s *AdminSessionStore) Delete(ctx context.Context, tokenHash string) error {
	ctx, span := s.tracer.Start(ctx, "Postgres.AdminSessionDelete")
	defer span.End()
	start := time.Now()

	_, err := dbOrTx(ctx, s.pool).Exec(ctx, `DELETE FROM admin_sessions WHERE token_hash = $1`, tokenHash)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("delete admin session: %w", err)
	}
	if s.metrics != nil && s.metrics.DBOperationDuration != nil {
		s.metrics.DBOperationDuration.Record(ctx, time.Since(start).Seconds(), dbAttrs("admin_session_delete"))
	}
	return nil
}
