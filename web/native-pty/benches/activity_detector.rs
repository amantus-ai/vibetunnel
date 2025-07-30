use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};

fn bench_regex_patterns(c: &mut Criterion) {
  let claude_pattern = regex::Regex::new(r"(\S)\s+(\w+)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+)\s*k?\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)").unwrap();
  let ansi_pattern = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();

  let mut group = c.benchmark_group("regex_patterns");

  // Test pattern matching performance
  let long_text = "Some normal text ".repeat(100) + "✻ Thinking… (5s)";
  let test_strings = vec![
    ("simple", "✻ Crafting… (10s)".to_string()),
    (
      "with_tokens",
      "✻ Processing… (42s · ↑ 2.5k tokens · esc to interrupt)".to_string(),
    ),
    ("no_match", "This is normal terminal output".to_string()),
    ("long_text", long_text),
  ];

  for (name, text) in test_strings {
    group.bench_with_input(
      BenchmarkId::new("claude_pattern", name),
      &text,
      |b, text| {
        b.iter(|| claude_pattern.is_match(black_box(text)));
      },
    );
  }

  // Test ANSI stripping performance
  let ansi_strings = vec![
    ("no_ansi", "Normal text without ANSI"),
    ("light_ansi", "\x1b[32mGreen text\x1b[0m"),
    (
      "heavy_ansi",
      "\x1b[2J\x1b[H\x1b[32;1mBold green\x1b[0m \x1b[33mYellow\x1b[0m",
    ),
  ];

  for (name, text) in ansi_strings {
    group.bench_with_input(BenchmarkId::new("ansi_stripping", name), text, |b, text| {
      b.iter(|| ansi_pattern.replace_all(black_box(text), ""));
    });
  }

  group.finish();
}

fn bench_regex_compilation(c: &mut Criterion) {
  c.bench_function("compile_claude_pattern", |b| {
        b.iter(|| {
            regex::Regex::new(r"(\S)\s+(\w+)…\s*\((\d+)s(?:\s*·\s*(\S?)\s*([\d.]+)\s*k?\s*tokens\s*·\s*[^)]+to\s+interrupt)?\)").unwrap()
        });
    });

  c.bench_function("compile_ansi_pattern", |b| {
    b.iter(|| regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap());
  });
}

criterion_group!(benches, bench_regex_patterns, bench_regex_compilation);
criterion_main!(benches);
