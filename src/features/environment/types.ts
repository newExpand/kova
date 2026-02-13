export interface EnvironmentCheck {
  tmuxInstalled: boolean;
  tmuxVersion: string | null;
  claudeCodeInstalled: boolean;
  claudeCodeVersion: string | null;
  shellType: string;
}
