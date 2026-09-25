# Multi-stage Dockerfile para game-server (Rust).
FROM rust:1.82-alpine AS build
WORKDIR /app
RUN apk add --no-cache musl-dev

COPY Cargo.toml Cargo.lock rust-toolchain.toml* ./
COPY crates/sim-core crates/sim-core
COPY crates/game-server crates/game-server

RUN cargo build --release -p game-server

FROM alpine:3.20 AS runtime
WORKDIR /app
COPY --from=build /app/target/release/game-server ./game-server

ENV BIND_ADDR=0.0.0.0:7777
EXPOSE 7777

CMD ["./game-server"]
