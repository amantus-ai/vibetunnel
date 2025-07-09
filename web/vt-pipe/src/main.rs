use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};

mod forwarder;
mod session;
mod socket_client;
mod terminal;

use forwarder::Forwarder;

#[derive(Parser)]
#[command(
  author,
  version,
  about = "Lightweight terminal forwarder for VibeTunnel"
)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum TitleMode {
  /// No title management - apps control their own titles
  None,
  /// Block all title changes from applications
  Filter,
  /// Show working directory and command in title
  Static,
  /// Show directory, command, and live activity status
  Dynamic,
}

#[tokio::main]
async fn main() -> Result<()> {
  let cli = Cli::parse();

  // Handle both direct execution and subcommand style
  match cli.command {
    Some(Commands::Fwd {
      title_mode,
      update_title,
      session_id,
      command,
    }) => handle_fwd(title_mode, update_title, session_id, command).await,
    None => {
      // Default behavior: treat args as command to forward
      if cli.args.is_empty() {
        // No command specified, launch shell
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        handle_fwd(TitleMode::None, None, None, vec![shell]).await
      } else {
        handle_fwd(TitleMode::None, None, None, cli.args).await
      }
    },
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
  use session::Session;
  use socket_client::SocketClient;

  // Load session info
  let session = Session::load(session_id).context("Failed to load session info")?;

  // Connect to socket and send update-title command
  let socket_path = session.socket_path();
  let mut client = SocketClient::connect(&socket_path)
    .await
    .context("Failed to connect to session socket")?;

  client.send_update_title(new_title).await?;

  // Update session.json
  session.update_title(new_title)?;

  Ok(())
}
