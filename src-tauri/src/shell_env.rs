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

pub fn read_shell_var(name: &str) -> Option<String> {
    if !name
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return None;
    }

    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/c", &format!("echo %{name}%")])
            .output()
            .ok()?
    } else {
        let (shell, login_flag) = login_shell();
        let command = with_user_path(&format!(
            r#"for f in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [ -f "$f" ]; then . "$f" >/dev/null 2>&1; fi;
done;
printf '%s' "${{{name}:-}}""#
        ));
        std::process::Command::new(shell)
            .args([login_flag, "-c", &command])
            .output()
            .ok()?
    };

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() || value == format!("%{name}%") {
        None
    } else {
        Some(value)
    }
}
