import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import toml from '@iarna/toml';
import prompts from 'prompts';

async function deploy() {
	console.log('Starting Telegram Bot deployment...\n');

	// 1. Create D1 database
	console.log('Creating D1 database...');
	const d1Output = execSync('wrangler d1 create telegram-summary-bot').toString();
	console.log(d1Output);

	// Extract database ID from output
	const databaseIdMatch = d1Output.match(/database_id = "([a-zA-Z0-9-]+)"/);
	if (!databaseIdMatch) {
		throw new Error('Failed to extract database ID from output');
	}
	const databaseId = databaseIdMatch[1];

	// 2. Update wrangler.toml
	const wranglerPath = join(process.cwd(), 'wrangler.toml');
	const wranglerContent = readFileSync(wranglerPath, 'utf8');
	const config = toml.parse(wranglerContent);
	delete config.d1_databases;
	config.d1_databases = [
		{
			binding: 'DB',
			database_name: 'telegram-summary-bot',
			database_id: databaseId,
		},
	];
	const newContent = toml.stringify(config);
	writeFileSync(wranglerPath, newContent);
	console.log('wrangler.toml configuration updated successfully\n');

	// 3. Create database tables
	console.log('Creating database tables...');
	execSync('wrangler d1 execute telegram-summary-bot --file=./schema.sql --remote');
	console.log('Database tables created successfully\n');

	// 4. Deploy project
	console.log('Deploying project...');
	const deployOutput = execSync('wrangler deploy').toString();
	console.log(deployOutput);
	// Extract Worker URL
	const workerUrlMatch = deployOutput.match(/https:\/\/[^\s]+\.workers\.dev/);
	if (!workerUrlMatch) {
		throw new Error('Failed to extract Worker URL from output');
	}
	const workerUrl = workerUrlMatch[0];
	console.log(`Worker URL: ${workerUrl}`);

	// 5. Set Bot Token
	const response = await prompts({
		type: 'password',
		name: 'botToken',
		message: 'Please enter your Telegram Bot Token',
	});
	const botToken = response.botToken.trim();
	if (!botToken) {
		throw new Error('Bot Token cannot be empty');
	}
	execSync(`wrangler secret put TELEGRAM_BOT_TOKEN`, { input: botToken });
	console.log('Bot Token set successfully\n');

	// 6. Set Webhook
	const webhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${workerUrl}`;
	console.log('Setting up Webhook...');
	await fetch(webhookUrl)
		.then((res) => {
			if (res.ok) {
				console.log('Webhook setup result:', res.json());
			} else {
				console.error('Webhook setup failed:', res.status, res.statusText);
			}
		})
		.catch((err) => {
			console.error('Webhook setup failed:', err instanceof Error ? err.message : err);
			console.error(`please set webhook manually: ${webhookUrl}`);
		});

	// 7. Reminder to disable Group Privacy mode
	console.log(
		'Please make sure to disable Group Privacy mode for your bot: /mybots -> select bot -> Bot Settings -> Group Privacy -> Turn off'
	);
}

try {
	deploy();
} catch (error) {
	console.error('Error during deployment:', error);
}
