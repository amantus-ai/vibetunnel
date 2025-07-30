use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};

mod api_client;
mod forwarder;
mod session;
mod socket_client;
mod terminal;

use forwarder::Forwarder;

#[derive(Parser)]
#[command(
  author,
  version,
  about = "Lightweight terminal forwarder for VibeTunnel",
  // Allow external subcommands so we can handle options before positional args
  allow_external_subcommands = true
)]
struct Cli {
  #[command(subcommand)]
  command: Option<Commands>,

  /// Session ID to use (instead of generating a new one)
  #[arg(long, global = true)]
  session_id: Option<String>,

  /// Terminal title management mode
  #[arg(long, value_enum, default_value = "none", global = true)]
  title_mode: TitleMode,
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
  // Parse args manually to handle the case where we have options before the command
  let args: Vec<String> = std::env::args().collect();
  
  // Try to parse with clap first
  match Cli::try_parse_from(&args) {
    Ok(cli) => {
      // Handle subcommands
      match cli.command {
        Some(Commands::Fwd {
          title_mode,
          update_title,
          session_id,
          command,
        }) => handle_fwd(title_mode, update_title, session_id, command).await,
        None => {
          // This shouldn't happen with external subcommands
          let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
          handle_fwd(cli.title_mode, None, cli.session_id, vec![shell]).await
        }
      }
    },
    Err(_) => {
      // Manual parsing for external subcommands
      let mut session_id = None;
      let mut title_mode = TitleMode::None;
      let mut command_args = Vec::new();
      let mut i = 1; // Skip program name
      
      while i < args.len() {
        if args[i] == "--session-id" && i + 1 < args.len() {
          session_id = Some(args[i + 1].clone());
          i += 2;
        } else if args[i] == "--title-mode" && i + 1 < args.len() {
          title_mode = match args[i + 1].as_str() {
            "none" => TitleMode::None,
            "filter" => TitleMode::Filter,
            "static" => TitleMode::Static,
            "dynamic" => TitleMode::Dynamic,
            _ => TitleMode::None,
          };
          i += 2;
        } else if args[i].starts_with("--") {
          // Unknown option, skip
          i += 1;
        } else {
          // Start of command
          command_args = args[i..].to_vec();
          break;
        }
      }
      
      if command_args.is_empty() {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        command_args = vec![shell];
      }
      
      handle_fwd(title_mode, None, session_id, command_args).await
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

  let mut forwarder = if let Some(sid) = session_id {
    Forwarder::with_session_id(title_mode, sid)?
  } else {
    Forwarder::new(title_mode)?
  };
  forwarder.run(command).await
}

async fn update_session_title(session_id: &str, new_title: &str) -> Result<()> {
  use session::Session;
  use socket_client::SocketClient;

  // Load session info to get the socket path
  let session = Session::load(session_id).context("Failed to load session info")?;

  // Connect to socket and send update-title command
  let socket_path = session.socket_path();
  let mut client = SocketClient::connect(&socket_path)
    .await
    .context("Failed to connect to session socket")?;

  client.send_update_title(new_title).await?;

  // Note: We no longer update session.json directly
  // The server will handle updating the file after receiving the command

  Ok(())
}
