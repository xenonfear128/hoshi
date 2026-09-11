FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build && chmod -R a+rX dist

FROM golang:1.26.8-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-s -w' -o /remoter ./cmd/remoter
RUN mkdir -p /agents && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -ldflags='-s -w' -o /agents/hoshi-agent-linux-amd64 ./cmd/hoshi-agent && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -buildvcs=false -ldflags='-s -w' -o /agents/hoshi-agent-linux-arm64 ./cmd/hoshi-agent

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=backend /remoter /app/remoter
COPY --from=backend /agents /app/agents
COPY --from=web /src/web/dist /app/web/dist
ENV LISTEN_ADDR=:8080 WEB_DIR=/app/web/dist AGENT_DIR=/app/agents
EXPOSE 8080
ENTRYPOINT ["/app/remoter"]
