#!/usr/bin/env node

/**
 * Memory Mesh Setup Script
 * Installs YAMO skills and tools into your project and Claude Code environment
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');
const FORCE_MODE = process.argv.includes('--force') || process.argv.includes('-f');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function promptUser(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${COLORS.yellow}${question}${COLORS.reset} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

async function copyWithPrompt(src, dest, label) {
  if (existsSync(dest) && !FORCE_MODE) {
    const answer = await promptUser(`${label} already exists at ${dest}. Overwrite? (y/n)`);
    if (answer !== 'y' && answer !== 'yes') {
      log(`  ⏭  Skipped ${label}`, 'yellow');
      return false;
    }
  }

  try {
    copyFileSync(src, dest);
    log(`  ✓ Installed ${label}`, 'green');
    return true;
  } catch (error) {
    log(`  ✗ Failed to install ${label}: ${error.message}`, 'red');
    return false;
  }
}

async function installSkills() {
  log('\n📦 Installing YAMO Skills...', 'blue');

  const targetDirs = [
    {
      name: 'Claude Code',
      base: join(homedir(), '.claude'),
      skills: join(homedir(), '.claude', 'skills', 'yamo-super')
    },
    {
      name: 'Gemini CLI',
      base: join(homedir(), '.gemini'),
      skills: join(homedir(), '.gemini', 'skills', 'yamo-super')
    }
  ];

  const skillsSourceDir = join(packageRoot, 'skills');
  if (!existsSync(skillsSourceDir)) {
    log('  ✗ Skills directory not found in package', 'red');
    return { installed: 0, skipped: 0 };
  }

  const skillFiles = readdirSync(skillsSourceDir);
  let totalInstalled = 0;
  let totalSkipped = 0;
  let detectedCount = 0;

  for (const target of targetDirs) {
    // Check if the CLI environment is detected
    if (!existsSync(target.base)) {
      continue;
    }

    detectedCount++;
    log(`  Installing to ${target.name}...`, 'blue');

    // Create skills directory
    if (!existsSync(target.skills)) {
      mkdirSync(target.skills, { recursive: true });
      log(`  ✓ Created ${target.skills}`, 'green');
    }

    for (const file of skillFiles) {
      const src = join(skillsSourceDir, file);
      const dest = join(target.skills, file);
      const success = await copyWithPrompt(src, dest, `${target.name}: ${file}`);
      if (success) totalInstalled++;
      else totalSkipped++;
    }
  }

  if (detectedCount === 0) {
    log('⚠  No supported AI environment detected (~/.claude or ~/.gemini not found)', 'yellow');
    log('   Skills will be skipped.', 'yellow');
  }

  return { installed: totalInstalled, skipped: totalSkipped };
}

async function installTools() {
  log('\n🔧 Installing Tools...', 'blue');

  const toolsDir = join(process.cwd(), 'tools');

  // Create tools directory if it doesn't exist
  if (!existsSync(toolsDir)) {
    mkdirSync(toolsDir, { recursive: true });
    log(`  ✓ Created ${toolsDir}`, 'green');
  }

  const toolFiles = [
    { src: 'memory_mesh.js', name: 'Memory Mesh CLI' }
  ];

  let installed = 0;
  let skipped = 0;

  for (const { src, name } of toolFiles) {
    const srcPath = join(packageRoot, 'bin', src);
    const destPath = join(toolsDir, src);

    if (!existsSync(srcPath)) {
      log(`  ✗ ${name} not found in package`, 'red');
      skipped++;
      continue;
    }

    const success = await copyWithPrompt(srcPath, destPath, name);
    if (success) installed++;
    else skipped++;
  }

  return { installed, skipped };
}

function showUsage() {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));

  log('\n✨ Setup Complete!', 'bright');
  log('\nYAMO Skills installed to AI CLI environments:', 'blue');
  log('  • ~/.claude/skills/yamo-super/', 'blue');
  log('  • ~/.gemini/skills/yamo-super/', 'blue');
  log('Tools installed to: ./tools/', 'blue');

  log('\n📚 Usage:', 'bright');
  log('  • Use /yamo-super in Claude or Gemini for workflow automation');
  log('  • Call tools/memory_mesh.js for memory operations');

  log('\n🔗 Learn more:', 'bright');
  log('  README: https://github.com/soverane-labs/memory-mesh');
  log(`  Version: ${pkg.version}`);
}

async function main() {
  log('\n╔════════════════════════════════════════╗', 'bright');
  log('║   Memory Mesh Setup                    ║', 'bright');
  log('║   Installing skills and tools...       ║', 'bright');
  log('╚════════════════════════════════════════╝', 'bright');

  try {
    // Install skills to ~/.claude/skills/yamo-super/
    const skillResults = await installSkills();

    // Install tools to ./tools/
    const toolResults = await installTools();

    // Summary
    const totalInstalled = skillResults.installed + toolResults.installed;
    const totalSkipped = skillResults.skipped + toolResults.skipped;

    log('\n' + '─'.repeat(40));
    log(`✓ Installed: ${totalInstalled}`, 'green');
    if (totalSkipped > 0) {
      log(`⏭  Skipped: ${totalSkipped}`, 'yellow');
    }

    if (totalInstalled > 0) {
      showUsage();
    }

    log('');
    process.exit(0);
  } catch (error) {
    log(`\n✗ Setup failed: ${error.message}`, 'red');
    log(`  ${error.stack}`, 'red');
    process.exit(1);
  }
}

main();
