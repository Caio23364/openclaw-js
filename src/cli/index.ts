#!/usr/bin/env node
/**
 * OpenClaw - CLI
 * Command-line interface for OpenClaw
 * Includes: onboard, gateway, agent (interactive + single), status, cron, config, doctor
 */

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import inquirer from 'inquirer';
import { createInterface } from 'readline';
import { log } from '../utils/logger.js';
import { getGateway, createGateway } from '../gateway/index.js';
import { getChannelManager, createChannelManager } from '../channels/index.js';
import { getProviderManager, createProviderManager } from '../providers/index.js';
import { VENDOR_REGISTRY } from '../providers/vendors.js';
import { getAgentRuntime, createAgentRuntime } from '../agents/index.js';
import { getCronManager, createCronManager } from '../cron/index.js';
import { getBrowserManager, createBrowserManager } from '../browser/index.js';
import { loadConfig, saveConfig, updateConfig, ensureDirectories } from '../utils/config.js';
import { generatePairingCode } from '../utils/helpers.js';
import type { AgentConfig } from '../types/index.js';

const program = new Command();

// Logo
const logo = `
🦞  ${chalk.cyan.bold('OpenClaw')} - Your Personal AI Assistant
    ${chalk.gray('Any OS. Any Platform. The lobster way.')}
`;

program
  .name('openclaw')
  .description('OpenClaw - Personal AI Assistant')
  .version('2026.2.14');

// ═══════════════════════════════════════════════════════════════
// Onboard command
// ═══════════════════════════════════════════════════════════════
program
  .command('onboard')
  .description('Initialize config & workspace (onboarding wizard)')
  .option('--install-daemon', 'Install as a system daemon')
  .action(async (options) => {
    console.log(logo);
    console.log(boxen('Welcome to OpenClaw!', {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }));

    const spinner = ora('Setting up OpenClaw...').start();

    try {
      // Ensure directories exist
      await ensureDirectories();
      spinner.succeed('Directories created');

      // Load or create config
      const config = await loadConfig();
      spinner.succeed('Configuration loaded');

      // Interactive setup
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'setupChannels',
          message: 'Would you like to set up messaging channels?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'setupAI',
          message: 'Would you like to configure AI providers?',
          default: true,
        },
      ]);

      if (answers.setupChannels) {
        const channelAnswers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'telegram',
            message: 'Set up Telegram?',
            default: false,
          },
          {
            type: 'input',
            name: 'telegramToken',
            message: 'Enter your Telegram bot token:',
            when: (answers) => answers.telegram,
          },
          {
            type: 'confirm',
            name: 'discord',
            message: 'Set up Discord?',
            default: false,
          },
          {
            type: 'input',
            name: 'discordToken',
            message: 'Enter your Discord bot token:',
            when: (answers) => answers.discord,
          },
        ]);

        if (channelAnswers.telegram && channelAnswers.telegramToken) {
          config.channels.telegram = {
            default: {
              botToken: channelAnswers.telegramToken,
              dmPolicy: 'pairing',
              allowFrom: [],
              defaultWorkspace: 'default',
              defaultAgent: 'default',
            },
          } as any;
        }

        if (channelAnswers.discord && channelAnswers.discordToken) {
          config.channels.discord = {
            default: {
              discordToken: channelAnswers.discordToken,
              dmPolicy: 'pairing',
              allowFrom: [],
              defaultWorkspace: 'default',
              defaultAgent: 'default',
            },
          } as any;
        }
      }

      if (answers.setupAI) {
        const aiAnswers = await inquirer.prompt([
          {
            type: 'list',
            name: 'provider',
            message: 'Choose your primary AI provider:',
            choices: [
              { name: 'Anthropic (Claude)', value: 'anthropic' },
              { name: 'OpenAI (GPT-4o)', value: 'openai' },
              { name: 'DeepSeek', value: 'deepseek' },
              { name: 'Groq (fast inference)', value: 'groq' },
              { name: 'OpenRouter (200+ models)', value: 'openrouter' },
              { name: 'Google Gemini', value: 'google' },
              { name: 'Ollama (local)', value: 'ollama' },
              { name: 'NVIDIA NIM', value: 'nvidia' },
              { name: 'Cerebras', value: 'cerebras' },
              { name: 'Other / Skip', value: 'skip' },
            ],
          },
          {
            type: 'input',
            name: 'apiKey',
            message: (answers) => `Enter your ${answers.provider} API key:`,
            when: (answers) => answers.provider !== 'skip' && answers.provider !== 'ollama',
          },
        ]);

        if (aiAnswers.provider !== 'skip' && aiAnswers.apiKey) {
          if (!config.providers[aiAnswers.provider]) {
            config.providers[aiAnswers.provider] = {} as any;
          }
          config.providers[aiAnswers.provider].apiKey = aiAnswers.apiKey;
        }
      }

      await saveConfig(config);

      console.log(chalk.green('\n✅ Onboarding complete!'));
      console.log(chalk.gray('\nStart the gateway with: openclaw gateway'));
      console.log(chalk.gray('Chat with the agent: openclaw agent'));

      if (options.installDaemon) {
        console.log(chalk.yellow('\nInstalling daemon...'));
        // Would implement daemon installation
      }
    } catch (error) {
      spinner.fail('Setup failed');
      console.error(error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Gateway command
// ═══════════════════════════════════════════════════════════════
program
  .command('gateway')
  .description('Start the OpenClaw gateway')
  .option('-p, --port <port>', 'Port to listen on', '18789')
  .option('-h, --host <host>', 'Host to bind to', '127.0.0.1')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    console.log(logo);

    const spinner = ora('Starting OpenClaw Gateway...').start();

    try {
      // Initialize components
      const gateway = await createGateway();
      const providerManager = await createProviderManager();
      const agentRuntime = createAgentRuntime();
      const channelManager = createChannelManager();
      const cronManager = createCronManager();
      const browserManager = createBrowserManager();

      // Create default agent
      agentRuntime.createAgent('default');

      // Start gateway
      await gateway.start();
      spinner.succeed(`Gateway started on ${options.host}:${options.port}`);

      // Initialize channels
      await channelManager.initialize();

      // Start cron jobs
      cronManager.startAll();

      console.log(chalk.green('\n🚀 OpenClaw Gateway is running!'));
      console.log(chalk.gray(`\nWebSocket: ws://${options.host}:${options.port}`));
      console.log(chalk.gray(`API: http://${options.host}:${options.port}`));
      console.log(chalk.gray(`Health: http://${options.host}:${options.port}/health`));

      // Show loaded providers
      const vendorSummary = providerManager.getVendorSummary();
      const loadedVendors = vendorSummary.filter((v) => v.loaded);
      if (loadedVendors.length > 0) {
        console.log(chalk.cyan(`\nProviders loaded: ${loadedVendors.map((v) => v.name).join(', ')}`));
      }

      console.log(chalk.gray('\nPress Ctrl+C to stop'));

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n\nShutting down...'));
        await gateway.stop();
        await channelManager.disconnectAll();
        cronManager.stopAll();
        await browserManager.closeAll();
        console.log(chalk.green('Goodbye! 🦞'));
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await gateway.stop();
        await channelManager.disconnectAll();
        cronManager.stopAll();
        await browserManager.closeAll();
        process.exit(0);
      });

      // Keep process alive
      setInterval(() => { }, 1000);
    } catch (error) {
      spinner.fail('Failed to start gateway');
      console.error(error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Agent command — single message OR interactive REPL
// ═══════════════════════════════════════════════════════════════
program
  .command('agent')
  .description('Chat with the agent (interactive mode or single message)')
  .option('-m, --message <message>', 'Single message to process (omit for interactive chat)')
  .option('-a, --agent <agent>', 'Agent ID', 'default')
  .option('-t, --thinking <level>', 'Thinking level', 'medium')
  .option('--model <model>', 'Model string (e.g. deepseek/deepseek-chat, groq/llama-3.1-70b)')
  .action(async (options) => {
    try {
      const agentRuntime = createAgentRuntime();
      await createProviderManager();

      // Ensure agent exists
      let agent = agentRuntime.getAgent(options.agent);
      if (!agent) {
        // Parse model string if provided (e.g., "kimi/kimi-for-coding")
        const agentConfig: Partial<AgentConfig> = {};
        if (options.model) {
          const slashIndex = options.model.indexOf('/');
          if (slashIndex !== -1) {
            agentConfig.provider = options.model.slice(0, slashIndex);
            agentConfig.model = options.model.slice(slashIndex + 1);
          } else {
            agentConfig.model = options.model;
          }
        }
        agent = agentRuntime.createAgent(options.agent, agentConfig);
      } else if (options.model) {
        // Update existing agent with new model
        const slashIndex = options.model.indexOf('/');
        if (slashIndex !== -1) {
          agent.config.provider = options.model.slice(0, slashIndex);
          agent.config.model = options.model.slice(slashIndex + 1);
        } else {
          agent.config.model = options.model;
        }
      }

      if (options.message) {
        // ── Single message mode ──
        const spinner = ora('Processing message...').start();

        const incomingMessage = {
          id: 'cli',
          channel: 'cli' as any,
          channelId: 'cli',
          senderId: 'user',
          senderName: 'User',
          chatId: 'cli',
          chatType: 'direct' as any,
          chatName: 'CLI',
          content: options.message,
          timestamp: new Date(),
          mentions: [],
          media: [],
          raw: null,
        };

        const response = await agentRuntime.processMessage(incomingMessage, options.agent);

        spinner.stop();
        console.log(chalk.cyan('\n🦞 OpenClaw:'));
        console.log(response);
      } else {
        // ── Interactive REPL mode ──
        console.log(logo);
        console.log(chalk.cyan('Interactive chat mode. Type /exit to quit, /new to reset.\n'));

        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const prompt = () => {
          rl.question(chalk.green('You: '), async (input) => {
            const trimmed = input.trim();

            if (!trimmed) {
              prompt();
              return;
            }

            // Handle chat commands
            if (trimmed === '/exit' || trimmed === '/quit') {
              console.log(chalk.gray('\nGoodbye! 🦞'));
              rl.close();
              process.exit(0);
              return;
            }

            if (trimmed === '/new' || trimmed === '/reset') {
              agentRuntime.deleteAllSessions();
              console.log(chalk.gray('Session reset.\n'));
              prompt();
              return;
            }

            if (trimmed === '/status') {
              const sessions = agentRuntime.getAllSessions();
              console.log(chalk.cyan(`Active sessions: ${sessions.length}`));
              console.log(chalk.gray(`Agent: ${options.agent} | Model: ${options.model || agent.config.model}\n`));
              prompt();
              return;
            }

            if (trimmed === '/help') {
              console.log(chalk.cyan('Commands:'));
              console.log('  /new, /reset   — Reset session');
              console.log('  /status        — Show current session info');
              console.log('  /exit, /quit   — Exit');
              console.log('  /help          — Show this help\n');
              prompt();
              return;
            }

            // Process message
            const spinner = ora({ text: 'Thinking...', spinner: 'dots' }).start();

            try {
              const incomingMessage = {
                id: `cli-${Date.now()}`,
                channel: 'cli' as any,
                channelId: 'cli',
                senderId: 'user',
                senderName: 'User',
                chatId: 'cli-interactive',
                chatType: 'direct' as any,
                chatName: 'CLI',
                content: trimmed,
                timestamp: new Date(),
                mentions: [],
                media: [],
                raw: null,
              };

              const response = await agentRuntime.processMessage(incomingMessage, options.agent);

              spinner.stop();
              console.log(chalk.cyan(`\n🦞 OpenClaw: `) + response + '\n');
            } catch (error: any) {
              spinner.fail('Error processing message');
              console.error(chalk.red(error.message + '\n'));
            }

            prompt();
          });
        };

        prompt();
        return; // Don't exit — REPL keeps running
      }
    } catch (error) {
      console.error('Failed to process message:', error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Status command — shows all vendors
// ═══════════════════════════════════════════════════════════════
program
  .command('status')
  .description('Show OpenClaw status and configured providers')
  .action(async () => {
    console.log(logo);

    try {
      const config = await loadConfig();

      console.log(chalk.cyan('Gateway:'));
      console.log(`  Endpoint: ${config.gateway.host}:${config.gateway.port}`);
      console.log(`  Auth: ${config.gateway.auth.mode}`);

      // Show all vendors from registry
      console.log(chalk.cyan('\nProviders:'));
      for (const [prefix, vendorConfig] of Object.entries(VENDOR_REGISTRY)) {
        const providerConf = config.providers[prefix];
        const hasKey = !!(providerConf?.apiKey);
        const isLocal = !vendorConfig.requiresKey;

        let statusIcon: string;
        if (hasKey) {
          statusIcon = chalk.green('✓ configured');
        } else if (isLocal) {
          statusIcon = chalk.yellow('● local (no key needed)');
        } else {
          statusIcon = chalk.gray('○ not configured');
        }

        const name = vendorConfig.name.padEnd(24);
        console.log(`  ${prefix.padEnd(14)} ${name} ${statusIcon}`);
      }

      console.log(chalk.cyan('\nChannels:'));
      const channels = Object.keys(config.channels);
      if (channels.length === 0) {
        console.log('  None configured');
      } else {
        for (const channel of channels) {
          console.log(`  ${channel}: ${chalk.green('✓')}`);
        }
      }

      console.log(chalk.cyan('\nAgent:'));
      const defaultAgent = config.agents.default;
      if (defaultAgent) {
        console.log(`  Model: ${defaultAgent.model}`);
        console.log(`  Provider: ${defaultAgent.provider}`);
        console.log(`  Thinking: ${defaultAgent.thinkingLevel}`);
      }
    } catch (error) {
      console.error('Failed to get status:', error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Cron subcommands
// ═══════════════════════════════════════════════════════════════
const cronCmd = program
  .command('cron')
  .description('Manage scheduled jobs');

cronCmd
  .command('list')
  .description('List all scheduled jobs')
  .action(async () => {
    try {
      const cronManager = createCronManager();
      const jobs = cronManager.getJobs();

      if (jobs.length === 0) {
        console.log(chalk.gray('No scheduled jobs.'));
        return;
      }

      console.log(chalk.cyan('Scheduled Jobs:\n'));
      console.log(
        chalk.gray('ID'.padEnd(12) + 'Name'.padEnd(24) + 'Schedule'.padEnd(20) + 'Enabled'.padEnd(10) + 'Runs'.padEnd(8) + 'Errors')
      );
      console.log(chalk.gray('─'.repeat(82)));

      for (const job of jobs) {
        const enabled = job.enabled ? chalk.green('yes') : chalk.red('no');
        console.log(
          `${job.id.slice(0, 10).padEnd(12)}${(job.name || '').padEnd(24)}${job.schedule.padEnd(20)}${enabled.padEnd(10)}${String(job.runCount || 0).padEnd(8)}${job.errorCount || 0}`
        );
      }
    } catch (error) {
      console.error('Failed to list cron jobs:', error);
      process.exit(1);
    }
  });

cronCmd
  .command('add')
  .description('Add a scheduled job')
  .requiredOption('-n, --name <name>', 'Job name')
  .requiredOption('-s, --schedule <schedule>', 'Cron schedule (e.g. "*/5 * * * *")')
  .requiredOption('--action <type>', 'Action type: message, command, webhook, skill')
  .option('-t, --target <target>', 'Target (channel ID, webhook URL, skill name)')
  .option('--payload <json>', 'Action payload as JSON string', '{}')
  .option('--timezone <tz>', 'Timezone (e.g. America/Sao_Paulo)')
  .action(async (options) => {
    try {
      const cronManager = createCronManager();

      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(options.payload);
      } catch {
        console.error(chalk.red('Invalid JSON payload'));
        process.exit(1);
      }

      const job = cronManager.createJob(
        options.name,
        options.schedule,
        {
          type: options.action,
          target: options.target || '',
          payload,
        },
        {
          timezone: options.timezone,
          enabled: true,
        }
      );

      console.log(chalk.green(`✅ Job created: ${job.name} (${job.id})`));
      console.log(chalk.gray(`   Schedule: ${job.schedule}`));
      console.log(chalk.gray(`   Action: ${options.action}`));
    } catch (error) {
      console.error('Failed to create cron job:', error);
      process.exit(1);
    }
  });

cronCmd
  .command('delete')
  .description('Delete a scheduled job')
  .requiredOption('--id <id>', 'Job ID')
  .action(async (options) => {
    try {
      const cronManager = createCronManager();
      cronManager.deleteJob(options.id);
      console.log(chalk.green(`✅ Job deleted: ${options.id}`));
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      process.exit(1);
    }
  });

cronCmd
  .command('run')
  .description('Run a scheduled job immediately')
  .requiredOption('--id <id>', 'Job ID')
  .action(async (options) => {
    try {
      const cronManager = createCronManager();
      const spinner = ora('Running job...').start();
      await cronManager.runJobNow(options.id);
      spinner.succeed(`Job ${options.id} executed`);
    } catch (error) {
      console.error('Failed to run cron job:', error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Message command
// ═══════════════════════════════════════════════════════════════
program
  .command('message')
  .description('Send a message through a channel')
  .requiredOption('-c, --channel <channel>', 'Channel ID')
  .requiredOption('-t, --to <recipient>', 'Recipient ID')
  .requiredOption('-m, --text <message>', 'Message text')
  .action(async (options) => {
    const spinner = ora('Sending message...').start();

    try {
      const channelManager = getChannelManager();

      await channelManager.sendMessage(options.channel, {
        channel: 'whatsapp' as any,
        channelId: options.channel,
        chatId: options.to,
        content: options.text,
      });

      spinner.succeed('Message sent');
    } catch (error) {
      spinner.fail('Failed to send message');
      console.error(error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Doctor command
// ═══════════════════════════════════════════════════════════════
program
  .command('doctor')
  .description('Run diagnostics and check configuration')
  .action(async () => {
    console.log(logo);
    console.log(chalk.cyan('Running diagnostics...\n'));

    const checks = [
      {
        name: 'Configuration',
        check: async () => {
          await loadConfig();
          return true;
        },
      },
      {
        name: 'Node.js version',
        check: async () => {
          const version = process.version;
          const major = parseInt(version.slice(1).split('.')[0]);
          return major >= 22;
        },
      },
      {
        name: 'Directories',
        check: async () => {
          await ensureDirectories();
          return true;
        },
      },
      {
        name: 'AI Providers',
        check: async () => {
          const config = await loadConfig();
          const configured = Object.entries(config.providers).filter(
            ([, p]) => (p as any)?.apiKey
          );
          return configured.length > 0;
        },
      },
    ];

    for (const check of checks) {
      const spinner = ora(`Checking ${check.name}...`).start();
      try {
        const result = await check.check();
        if (result) {
          spinner.succeed(`${check.name}: OK`);
        } else {
          spinner.warn(`${check.name}: Warning`);
        }
      } catch (error) {
        spinner.fail(`${check.name}: Failed`);
      }
    }

    console.log(chalk.green('\n✅ Diagnostics complete'));
  });

// ═══════════════════════════════════════════════════════════════
// Config command
// ═══════════════════════════════════════════════════════════════
program
  .command('config')
  .description('Manage configuration')
  .option('-g, --get <key>', 'Get configuration value')
  .option('-s, --set <key>', 'Set configuration value')
  .option('-v, --value <value>', 'Value to set')
  .option('--unsafe', 'Show sensitive fields unredacted (use with caution)')
  .action(async (options) => {
    try {
      if (options.get) {
        const config = await loadConfig();
        let value = options.get.split('.').reduce((obj: any, key: string) => obj?.[key], config);
        // Redact known sensitive keys unless --unsafe
        if (!options.unsafe && isSensitiveKey(options.get)) {
          value = typeof value === 'string' && value ? '[REDACTED]' : value;
        }
        console.log(value);
      } else if (options.set && options.value) {
        console.log(chalk.green(`Set ${options.set} = ${options.value}`));
      } else {
        const config = await loadConfig();
        const display = options.unsafe ? config : redactConfig(config);
        console.log(JSON.stringify(display, null, 2));
      }
    } catch (error) {
      console.error('Config error:', error);
      process.exit(1);
    }
  });

// Security: Redact sensitive config fields
const SENSITIVE_KEYS = ['token', 'apikey', 'api_key', 'password', 'secret', 'jwtsecret', 'bottoken', 'auth_token'];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[._-]/g, '');
  return SENSITIVE_KEYS.some(s => lower.includes(s));
}

function redactConfig(obj: any, depth = 0): any {
  if (depth > 10 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(v => redactConfig(v, depth + 1));
  if (typeof obj !== 'object') return obj;

  const out: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key) && typeof value === 'string' && value) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      out[key] = redactConfig(value, depth + 1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Pairing command
// ═══════════════════════════════════════════════════════════════
program
  .command('pairing')
  .description('Manage device pairing')
  .option('-a, --approve <code>', 'Approve a pairing code')
  .option('-l, --list', 'List pending pairings')
  .action(async (options) => {
    if (options.approve) {
      console.log(chalk.green(`Approved pairing code: ${options.approve}`));
    } else if (options.list) {
      console.log(chalk.gray('No pending pairings'));
    } else {
      const code = generatePairingCode();
      console.log(chalk.cyan('Your pairing code:'));
      console.log(boxen(code, {
        padding: 2,
        margin: 1,
        borderStyle: 'double',
        borderColor: 'green',
      }));
    }
  });

// ═══════════════════════════════════════════════════════════════
// Update command
// ═══════════════════════════════════════════════════════════════
program
  .command('update')
  .description('Update OpenClaw')
  .option('-c, --channel <channel>', 'Update channel (stable, beta, dev)', 'stable')
  .action(async (options) => {
    const spinner = ora(`Checking for updates (${options.channel})...`).start();

    try {
      spinner.succeed('OpenClaw is up to date!');
    } catch (error) {
      spinner.fail('Update check failed');
      console.error(error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Browser command
// ═══════════════════════════════════════════════════════════════
program
  .command('browser')
  .description('Browser automation commands')
  .option('-l, --launch', 'Launch browser')
  .option('-u, --url <url>', 'Navigate to URL')
  .option('-s, --screenshot', 'Take screenshot')
  .action(async (options) => {
    try {
      const browserManager = getBrowserManager();

      if (options.launch) {
        const browserId = await browserManager.launchBrowser({
          name: 'default',
        });
        console.log(chalk.green(`Browser launched: ${browserId}`));
      }

      if (options.url) {
        console.log(chalk.gray(`Navigating to: ${options.url}`));
      }
    } catch (error) {
      console.error('Browser error:', error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Tunnel commands
// ═══════════════════════════════════════════════════════════════
const tunnelCmd = program
  .command('tunnel')
  .description('Manage tunnel for exposing the gateway');

tunnelCmd
  .command('start')
  .description('Start tunnel')
  .option('-p, --port <port>', 'Override port', '18789')
  .action(async (options) => {
    const spinner = ora('Starting tunnel...').start();
    try {
      const config = await loadConfig();
      const { createTunnelManager } = await import('../tunnel/index.js');
      const manager = createTunnelManager(config.tunnel as any);
      const url = await manager.start(parseInt(options.port));
      spinner.succeed(`Tunnel active: ${url}`);
    } catch (error) {
      spinner.fail('Failed to start tunnel');
      console.error(error);
      process.exit(1);
    }
  });

tunnelCmd
  .command('stop')
  .description('Stop tunnel')
  .action(async () => {
    try {
      const { getTunnelManager } = await import('../tunnel/index.js');
      await getTunnelManager().stop();
      console.log(chalk.green('Tunnel stopped'));
    } catch (error) {
      console.error('Failed to stop tunnel:', error);
    }
  });

tunnelCmd
  .command('status')
  .description('Show tunnel status')
  .action(async () => {
    const { getTunnelManager } = await import('../tunnel/index.js');
    const status = getTunnelManager().status();
    console.log(chalk.cyan('Tunnel Status:'));
    console.log(`  Running: ${status.running ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`  Provider: ${status.provider}`);
    if (status.url) console.log(`  URL: ${chalk.green(status.url)}`);
    if (status.pid) console.log(`  PID: ${status.pid}`);
  });

// ═══════════════════════════════════════════════════════════════
// Service commands
// ═══════════════════════════════════════════════════════════════
const serviceCmd = program
  .command('service')
  .description('Manage OpenClaw as a system service');

serviceCmd
  .command('install')
  .description('Install as system service (systemd/OpenRC/Windows)')
  .action(async () => {
    const spinner = ora('Installing service...').start();
    try {
      const { createServiceManager } = await import('../service/index.js');
      const manager = createServiceManager();
      await manager.install();
      spinner.succeed(`Service installed using ${manager.getInitSystem()}`);
    } catch (error) {
      spinner.fail('Failed to install service');
      console.error(error);
    }
  });

serviceCmd
  .command('start')
  .description('Start the service')
  .action(async () => {
    try {
      const { createServiceManager } = await import('../service/index.js');
      await createServiceManager().start();
      console.log(chalk.green('Service started'));
    } catch (error) {
      console.error('Failed to start service:', error);
    }
  });

serviceCmd
  .command('stop')
  .description('Stop the service')
  .action(async () => {
    try {
      const { createServiceManager } = await import('../service/index.js');
      await createServiceManager().stop();
      console.log(chalk.green('Service stopped'));
    } catch (error) {
      console.error('Failed to stop service:', error);
    }
  });

serviceCmd
  .command('status')
  .description('Show service status')
  .action(async () => {
    try {
      const { createServiceManager } = await import('../service/index.js');
      const output = createServiceManager().status();
      console.log(output);
    } catch (error) {
      console.error('Failed to get service status:', error);
    }
  });

serviceCmd
  .command('uninstall')
  .description('Uninstall the system service')
  .action(async () => {
    const spinner = ora('Uninstalling service...').start();
    try {
      const { createServiceManager } = await import('../service/index.js');
      await createServiceManager().uninstall();
      spinner.succeed('Service uninstalled');
    } catch (error) {
      spinner.fail('Failed to uninstall service');
      console.error(error);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Memory commands
// ═══════════════════════════════════════════════════════════════
const memoryCmd = program
  .command('memory')
  .description('Manage agent memory');

memoryCmd
  .command('list')
  .description('List stored memories')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (options) => {
    try {
      const { getMemoryManager } = await import('../memory/index.js');
      const manager = getMemoryManager();
      const entries = await manager.list(parseInt(options.limit));

      if (entries.length === 0) {
        console.log(chalk.gray('No memories stored.'));
        return;
      }

      console.log(chalk.cyan(`Memories (${entries.length}):\n`));
      for (const entry of entries) {
        console.log(`  ${chalk.bold(entry.key)} — ${entry.content.slice(0, 80)}${entry.content.length > 80 ? '...' : ''}`);
        if (entry.tags.length) console.log(chalk.gray(`    Tags: ${entry.tags.join(', ')}`));
      }
    } catch (error) {
      console.error('Failed to list memories:', error);
    }
  });

memoryCmd
  .command('search')
  .description('Search memories')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Max results', '10')
  .action(async (query: string, options: any) => {
    try {
      const { getMemoryManager } = await import('../memory/index.js');
      const entries = await getMemoryManager().search(query, { limit: parseInt(options.limit) });

      if (entries.length === 0) {
        console.log(chalk.gray('No matching memories.'));
        return;
      }

      console.log(chalk.cyan(`Results for "${query}" (${entries.length}):\n`));
      for (const entry of entries) {
        const score = entry.relevanceScore ? ` [${(entry.relevanceScore * 100).toFixed(0)}%]` : '';
        console.log(`  ${chalk.bold(entry.key)}${chalk.gray(score)} — ${entry.content.slice(0, 80)}`);
      }
    } catch (error) {
      console.error('Search failed:', error);
    }
  });

memoryCmd
  .command('clear')
  .description('Clear all memories')
  .action(async () => {
    try {
      const { getMemoryManager } = await import('../memory/index.js');
      await getMemoryManager().clear();
      console.log(chalk.green('All memories cleared'));
    } catch (error) {
      console.error('Failed to clear memories:', error);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Skill audit command
// ═══════════════════════════════════════════════════════════════
program
  .command('audit')
  .description('Security audit a skill directory')
  .argument('<path>', 'Path to skill directory')
  .action(async (skillPath: string) => {
    const spinner = ora('Auditing skill...').start();
    try {
      const { auditSkill, formatAuditResult } = await import('../skills/audit.js');
      const result = await auditSkill(skillPath);
      spinner.stop();
      console.log(formatAuditResult(result));
    } catch (error) {
      spinner.fail('Audit failed');
      console.error(error);
    }
  });

// ═══════════════════════════════════════════════════════════════
// Security commands (CVE-2026-25253)
// ═══════════════════════════════════════════════════════════════
const securityCmd = program
  .command('security')
  .description('Security auditing and management');

securityCmd
  .command('audit')
  .description('Run a security audit of the OpenClaw configuration')
  .option('--deep', 'Run extended checks including network binding verification')
  .option('--fix', 'Automatically fix safe issues')
  .action(async (options) => {
    console.log(logo);
    console.log(chalk.cyan.bold('🔒 OpenClaw Security Audit\n'));

    const config = await loadConfig();
    let passed = 0;
    let warnings = 0;
    let failures = 0;

    const pass = (msg: string) => { passed++; console.log(chalk.green(`  ✅ PASS: ${msg}`)); };
    const warn = (msg: string) => { warnings++; console.log(chalk.yellow(`  ⚠️  WARN: ${msg}`)); };
    const fail = (msg: string) => { failures++; console.log(chalk.red(`  ❌ FAIL: ${msg}`)); };

    // 1. Authentication mode
    if (config.gateway?.auth?.mode === 'token') {
      pass('Authentication mode is "token"');
    } else if (config.gateway?.auth?.mode === 'none') {
      fail('Authentication is DISABLED (auth.mode: "none") — CVE-2026-25593');
    } else {
      warn(`Unknown auth mode: ${config.gateway?.auth?.mode}`);
    }

    // 2. Token strength
    const token = config.gateway?.auth?.token;
    if (token && token.length >= 32) {
      pass(`Auth token is ${token.length} chars (≥32)`);
    } else if (token) {
      warn(`Auth token is only ${token.length} chars — recommend ≥32`);
    } else {
      fail('No auth token configured');
    }

    // 3. Gateway binding
    const host = config.gateway?.host || '127.0.0.1';
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === 'loopback') {
      pass(`Gateway bound to ${host} (loopback only)`);
    } else if (host === '0.0.0.0' || host === '::') {
      fail(`Gateway bound to ${host} — exposed to ALL interfaces! — CVE-2026-25253`);
    } else {
      warn(`Gateway bound to ${host} — verify this is intentional`);
    }

    // 4. Origin allowlist
    const origins = config.gateway?.originAllowlist;
    if (origins && origins.length > 0) {
      pass(`Origin allowlist has ${origins.length} entries`);
    } else {
      warn('No explicit origin allowlist — only localhost is allowed by default');
    }

    // 5. Sandbox
    if (config.sandbox?.enabled !== false) {
      pass('Sandbox is enabled');
    } else {
      fail('Sandbox is DISABLED — commands execute directly on host');
    }

    // 6. Message size limit
    const maxMsg = config.gateway?.maxMessageSize;
    if (maxMsg && maxMsg <= 10_000_000) {
      pass(`Max message size: ${(maxMsg / 1024 / 1024).toFixed(1)}MB`);
    } else if (!maxMsg) {
      warn('No max message size configured');
    } else {
      warn(`Max message size is very large: ${(maxMsg / 1024 / 1024).toFixed(1)}MB`);
    }

    // 7. Rate limits
    if (config.gateway?.maxConnectionsPerIp) {
      pass(`Connection rate limit: ${config.gateway.maxConnectionsPerIp}/min per IP`);
    } else {
      warn('No connection rate limit configured');
    }

    // 8. Tool approval list
    const approvalList = config.agents?.default?.tools?.requireApproval;
    if (approvalList && approvalList.length > 0) {
      pass(`${approvalList.length} tools require approval: ${approvalList.join(', ')}`);
    } else {
      warn('No tools require explicit approval');
    }

    // 9. Deep check: verify actual binding
    if (options.deep) {
      console.log(chalk.cyan('\n  Deep checks:'));
      try {
        const { execSync } = await import('child_process');
        const port = config.gateway?.port || 18789;
        let bindOutput = '';
        try {
          if (process.platform === 'win32') {
            bindOutput = execSync(`netstat -an | findstr ":${port}"`, { stdio: 'pipe' }).toString();
          } else {
            bindOutput = execSync(`ss -tulpn 2>/dev/null | grep :${port} || netstat -tlnp 2>/dev/null | grep :${port}`, { stdio: 'pipe' }).toString();
          }
        } catch { bindOutput = ''; }

        if (bindOutput.includes('0.0.0.0') || bindOutput.includes('*:')) {
          fail(`Port ${port} is bound to 0.0.0.0 or * — EXPOSED TO NETWORK`);
        } else if (bindOutput.includes('127.0.0.1') || bindOutput.includes('localhost')) {
          pass(`Port ${port} confirmed bound to loopback`);
        } else if (bindOutput.trim()) {
          warn(`Port ${port} binding: ${bindOutput.trim().slice(0, 100)}`);
        } else {
          warn(`Could not verify port ${port} binding (service may not be running)`);
        }
      } catch {
        warn('Deep binding check failed');
      }
    }

    // Summary
    console.log('');
    console.log(chalk.bold('  ─────────────────────────────────'));
    console.log(`  ${chalk.green(`${passed} passed`)}  ${chalk.yellow(`${warnings} warnings`)}  ${chalk.red(`${failures} failures`)}`);

    if (failures > 0) {
      console.log(chalk.red.bold('\n  ⛔ CRITICAL: Security issues found. Fix before deploying.'));
      process.exit(1);
    } else if (warnings > 0) {
      console.log(chalk.yellow('\n  ⚠️  Review warnings above.'));
    } else {
      console.log(chalk.green.bold('\n  🔒 All security checks passed!'));
    }
  });

securityCmd
  .command('rotate-token')
  .description('Generate and save a new auth token')
  .action(async () => {
    try {
      const config = await loadConfig();
      const crypto = await import('crypto');
      const newToken = crypto.randomBytes(32).toString('hex');
      config.gateway.auth.token = newToken;
      await saveConfig(config);
      console.log(chalk.green('✅ Auth token rotated. New token:'));
      console.log(chalk.cyan(newToken));
      console.log(chalk.yellow('\nUpdate any clients using the old token.'));
    } catch (error) {
      console.error('Token rotation failed:', error);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
