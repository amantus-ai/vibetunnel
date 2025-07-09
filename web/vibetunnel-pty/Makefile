.PHONY: all build-addon build-cli format lint clean

all: build-addon build-cli

build-addon:
	npm run build

build-cli:
	cargo build --release --no-default-features --features cli --bin vt-pipe

format:
	cargo fmt

lint:
	cargo clippy -- -D warnings

clean:
	cargo clean
	rm -f *.node