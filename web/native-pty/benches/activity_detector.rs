use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use napi::bindgen_prelude::Buffer;
use vibetunnel_native_pty::ActivityDetector;

fn create_buffer(s: &str) -> Buffer {
    Buffer::from(s.as_bytes().to_vec())
}

fn bench_activity_detection(c: &mut Criterion) {
    let detector = ActivityDetector::new().unwrap();
    
    // Different input scenarios
    let inputs = vec![
        ("simple", "✻ Crafting… (10s)"),
        ("with_tokens", "✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)"),
        ("with_ansi", "\x1b[32m✻ Thinking…\x1b[0m (100s · ↓ 10k tokens · esc to interrupt)"),
        ("no_match", "This is normal terminal output without any Claude status"),
        ("multiple_lines", "Line 1\nLine 2\n✻ Analyzing… (5s)\nLine 4"),
    ];
    
    let mut group = c.benchmark_group("activity_detection");
    
    for (name, input) in inputs {
        group.bench_with_input(
            BenchmarkId::new("detect", name),
            input,
            |b, input| {
                let buffer = create_buffer(input);
                b.iter(|| {
                    detector.detect(black_box(buffer.clone()))
                });
            },
        );
    }
    
    group.finish();
}

fn bench_activity_detection_buffer_sizes(c: &mut Criterion) {
    let detector = ActivityDetector::new().unwrap();
    
    let mut group = c.benchmark_group("buffer_sizes");
    
    // Test different buffer sizes
    for size in [100, 1_000, 10_000, 100_000, 1_000_000] {
        let mut text = String::with_capacity(size);
        
        // Fill with normal text
        for _ in 0..(size / 50) {
            text.push_str("This is some normal terminal output line\n");
        }
        
        // Add Claude status at the end
        text.push_str("✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)");
        
        group.bench_with_input(
            BenchmarkId::new("detect", format!("{}KB", size / 1000)),
            &text,
            |b, text| {
                let buffer = create_buffer(text);
                b.iter(|| {
                    detector.detect(black_box(buffer.clone()))
                });
            },
        );
    }
    
    group.finish();
}

fn bench_ansi_stripping(c: &mut Criterion) {
    let detector = ActivityDetector::new().unwrap();
    
    let mut group = c.benchmark_group("ansi_stripping");
    
    // Create text with varying amounts of ANSI codes
    let base = "✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)";
    
    let inputs = vec![
        ("no_ansi", base.to_string()),
        ("light_ansi", format!("\x1b[32m{}\x1b[0m", base)),
        ("heavy_ansi", format!(
            "\x1b[2J\x1b[H\x1b[32;1m✻\x1b[0m \x1b[33mProcessing…\x1b[0m \x1b[36m(42s\x1b[0m · \x1b[31m↑\x1b[0m \x1b[35m2.5k\x1b[0m tokens · esc to interrupt)"
        )),
        ("repeated_ansi", {
            let mut s = String::new();
            for _ in 0..10 {
                s.push_str("\x1b[32mText\x1b[0m ");
            }
            s.push_str(base);
            s
        }),
    ];
    
    for (name, input) in inputs {
        group.bench_with_input(
            BenchmarkId::new("detect", name),
            &input,
            |b, input| {
                let buffer = create_buffer(input);
                b.iter(|| {
                    detector.detect(black_box(buffer.clone()))
                });
            },
        );
    }
    
    group.finish();
}

fn bench_regex_compilation(c: &mut Criterion) {
    c.bench_function("activity_detector_new", |b| {
        b.iter(|| {
            ActivityDetector::new().unwrap()
        });
    });
}

fn bench_worst_case_patterns(c: &mut Criterion) {
    let detector = ActivityDetector::new().unwrap();
    
    let mut group = c.benchmark_group("worst_case");
    
    // Patterns that might cause regex backtracking
    let inputs = vec![
        ("many_dots", "✻" + &".".repeat(100) + "… (10s)"),
        ("many_parens", "✻ Processing… " + &"(".repeat(50) + "10s" + &")".repeat(50)),
        ("almost_match", "✻ Processing… (not-a-number-s · ↑ also-not-a-number tokens · esc to interrupt)"),
        ("unicode_spam", "✻ 处理中… (10秒 · ↑ 2.5千 代币 · 按ESC中断)"),
    ];
    
    for (name, input) in inputs {
        group.bench_with_input(
            BenchmarkId::new("detect", name),
            &input,
            |b, input| {
                let buffer = create_buffer(input);
                b.iter(|| {
                    detector.detect(black_box(buffer.clone()))
                });
            },
        );
    }
    
    group.finish();
}

fn bench_memory_usage(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory");
    
    // Benchmark creating many detectors
    group.bench_function("create_1000_detectors", |b| {
        b.iter(|| {
            let detectors: Vec<_> = (0..1000)
                .map(|_| ActivityDetector::new().unwrap())
                .collect();
            black_box(detectors);
        });
    });
    
    // Benchmark detecting on many small buffers
    group.bench_function("detect_1000_small_buffers", |b| {
        let detector = ActivityDetector::new().unwrap();
        let buffers: Vec<_> = (0..1000)
            .map(|i| create_buffer(&format!("✻ Task {}… ({}s)", i, i)))
            .collect();
        
        b.iter(|| {
            for buffer in &buffers {
                black_box(detector.detect(buffer.clone()));
            }
        });
    });
    
    group.finish();
}

criterion_group!(
    benches,
    bench_activity_detection,
    bench_activity_detection_buffer_sizes,
    bench_ansi_stripping,
    bench_regex_compilation,
    bench_worst_case_patterns,
    bench_memory_usage
);
criterion_main!(benches);