pub fn login_shell() -> (&'static str, &'static str) {
    if cfg!(target_os = "macos") {
        ("zsh", "-l")
    } else {
        ("bash", "-l")
    }
}

pub fn user_path_prefix() -> &'static str {
    r#"export NVM_DIR="${NVM_DIR:-$HOME/.nvm}";
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; fi;
for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.npm-global/bin /opt/homebrew/bin /usr/local/bin; do
  if [ -d "$d" ]; then PATH="$d:$PATH"; fi;
done;
export PATH"#
}

pub fn with_user_path(command: &str) -> String {
    format!("{}; {}", user_path_prefix(), command)
}

pub fn probe_command(bin: &str) -> String {
    with_user_path(&format!(
        "command -v {bin} >/dev/null 2>&1 && {bin} --version >/dev/null 2>&1"
    ))
}
