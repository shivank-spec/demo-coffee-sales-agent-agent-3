#!/usr/bin/env node
/*
 * agent.js — generated agent runtime (zero dependencies, Node >= 20).
 *
 * Reads system-prompt.md + business-info.json, sends the incoming message to
 * the Anthropic Messages API using YOUR OWN key from the ANTHROPIC_API_KEY
 * environment variable (a repository secret you add yourself), and prints the
 * reply. When run inside GitHub Actions on an issue or comment event, it also
 * posts the reply back as an issue comment.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function readRepoFile(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

async function postIssueComment(replyText) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const ghToken = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !ghToken || !repoFull || !fs.existsSync(eventPath)) return;
  let event;
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch (err) {
    return;
  }
  const issueNumber = event.issue && event.issue.number;
  if (!issueNumber) return;
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const url = apiBase + '/repos/' + repoFull + '/issues/' + issueNumber + '/comments';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ghToken,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ body: replyText })
  });
  if (!res.ok) {
    console.error('Warning: failed to post issue comment (' + res.status + ')');
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      'ANTHROPIC_API_KEY is not set. Add YOUR OWN Anthropic API key as a ' +
      'repository secret: Settings -> Secrets and variables -> Actions -> ' +
      'New repository secret -> name it ANTHROPIC_API_KEY.'
    );
    process.exit(1);
  }

  const config = JSON.parse(readRepoFile('agent.config.json'));
  const systemPrompt = readRepoFile('system-prompt.md');
  const businessInfo = JSON.parse(readRepoFile('business-info.json'));

  const message = (process.env.AGENT_MESSAGE || process.argv.slice(2).join(' ') || '').trim();
  if (!message) {
    console.error('No message provided. Set AGENT_MESSAGE or pass the message as CLI arguments.');
    process.exit(1);
  }

  const system =
    systemPrompt +
    '\n\n<business-info>\n' +
    JSON.stringify(businessInfo, null, 2) +
    '\n</business-info>\n';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: system,
      messages: [{ role: 'user', content: message }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 401) {
      console.error('Anthropic rejected the API key (401). Check the ANTHROPIC_API_KEY repo secret.');
    } else {
      console.error('Anthropic API error ' + res.status + ': ' + errText);
    }
    process.exit(1);
  }

  const data = await res.json();

  if (data.stop_reason === 'refusal') {
    console.error('The model declined this request (stop_reason: refusal).');
    process.exit(1);
  }

  const reply = (data.content || [])
    .filter(function (block) { return block.type === 'text'; })
    .map(function (block) { return block.text; })
    .join('\n')
    .trim();

  if (data.stop_reason === 'max_tokens') {
    console.error('Warning: reply was truncated at max_tokens.');
  }

  console.log(reply);
  await postIssueComment(reply);
}

main().catch(function (err) {
  console.error('Agent runtime failed:', err && err.message ? err.message : err);
  process.exit(1);
});
