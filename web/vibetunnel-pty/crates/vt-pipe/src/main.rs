use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use vibetunnel_pty_core::SessionStore;

mod forwarder;
mod session_store;
mod socket_client;
mod terminal;

use forwarder::{Forwarder, TitleMode};
use session_store::load_session;
use socket_client::SocketClient;

#[derive(Parser)]
#[command(author, version, about = "Lightweight terminal forwarder for VibeTunnel")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Command and arguments to execute (when not using subcommands)
    #[arg(trailing_var_arg = true)]
    args: Vec<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Forward a command through VibeTunnel (default behavior)
    Fwd {
        /// Terminal title management mode
        #[arg(long, value_enum, default_value = "none")]
        title_mode: TitleMode,

        /// Update the title of an existing session
        #[arg(long)]
        update_title: Option<String>,

        /// Session ID (for title updates)
        #[arg(long)]
        session_id: Option<String>,

        /// Command and arguments to execute
        #[arg(trailing_var_arg = true)]
        command: Vec<String>,
    },
}

impl ValueEnum for TitleMode {
    fn value_variants<'a>() -> &'a [Self] {
        &[TitleMode::None, TitleMode::Filter, TitleMode::Static, TitleMode::Dynamic]
    }

    fn to_possible_value(&self) -> Option<clap::builder::PossibleValue> {
        Some(match self {
            TitleMode::None => clap::builder::PossibleValue::new("none")
                .help("No title management - apps control their own titles"),
            TitleMode::Filter => clap::builder::PossibleValue::new("filter")
                .help("Block all title changes from applications"),
            TitleMode::Static => clap::builder::PossibleValue::new("static")
                .help("Show working directory and command in title"),
            TitleMode::Dynamic => clap::builder::PossibleValue::new("dynamic")
                .help("Show directory, command, and live activity status"),
        })
    }
}

impl std::str::FromStr for TitleMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "none" => Ok(TitleMode::None),
            "filter" => Ok(TitleMode::Filter),
            "static" => Ok(TitleMode::Static),
            "dynamic" => Ok(TitleMode::Dynamic),
            _ => Err(format!("Invalid title mode: {}", s)),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle both direct execution and subcommand style
    match cli.command {
        Some(Commands::Fwd { title_mode, update_title, session_id, command }) => {
            handle_fwd(title_mode, update_title, session_id, command).await
        }
        None => {
            // Default behavior: treat args as command to forward
            if cli.args.is_empty() {
                // No command specified, launch shell
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
                handle_fwd(TitleMode::None, None, None, vec![shell]).await
            } else {
                handle_fwd(TitleMode::None, None, None, cli.args).await
            }
        }
    }
}

async fn handle_fwd(
    title_mode: TitleMode,
    update_title: Option<String>,
    session_id: Option<String>,
    command: Vec<String>,
) -> Result<()> {
    // Special case: title update only
    if let Some(new_title) = update_title {
        if let Some(sid) = session_id {
            return update_session_title(&sid, &new_title).await;
        } else {
            anyhow::bail!("--session-id required when using --update-title");
        }
    }

    // Normal forwarding mode
    if command.is_empty() {
        anyhow::bail!("No command specified");
    }

    let mut forwarder = Forwarder::new(title_mode)?;
    forwarder.run(command).await
}

async fn update_session_title(session_id: &str, new_title: &str) -> Result<()> {
    // Load session info
    let (mut info, mut store) = load_session(session_id).context("Failed to load session info")?;

    // Connect to socket and send update-title command
    let socket_path = store.socket_path();
    let mut client = SocketClient::connect_with_retry(&socket_path, 10, 100)
        .await
        .context("Failed to connect to session socket")?;

    client.send_update_title(new_title).await?;

    // Update session.json
    info.name = new_title.to_string();
    store.update_session(session_id, info)?;

    Ok(())
}
