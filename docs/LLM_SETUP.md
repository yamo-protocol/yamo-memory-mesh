# LLM Setup Guide for YAMO Memory Mesh

## Supported Providers

| Provider | Use Case | Cost | Latency |
|----------|----------|------|--------|
| **OpenAI** | Production, highest quality | $$$ | Low |
| **Anthropic** | Production, great for reasoning | $$$ | Low |
| **Ollama** | Local, private, free | Free | Medium |

---

## Option 1: OpenAI (Recommended for Production)

### 1. Get API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Navigate to **API Keys** → **Create new secret key**
4. Copy your API key (starts with `sk-`)

### 2. Configure Environment Variables

```bash
# Linux/macOS
export LLM_PROVIDER=openai
export LLM_API_KEY=sk-your-key-here
export LLM_MODEL=gpt-4o-mini

# Windows (PowerShell)
$env:LLM_PROVIDER="openai"
$env:LLM_API_KEY="sk-your-key-here"
$env:LLM_MODEL="gpt-4o-mini"
```

### 3. Or Create `.env` File

```bash
# .env file in your project root
LLM_PROVIDER=openai
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o-mini
```

### 4. Recommended Models

| Model | Context | Best For |
|-------|---------|----------|
| `gpt-4o-mini` | 128K | Fast, cost-effective reflections |
| `gpt-4o` | 128K | Complex reasoning |
| `gpt-4-turbo` | 128K | Very fast reflections |

---

## Option 2: Anthropic Claude

### 1. Get API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys** → **Create Key**
4. Copy your API key

### 2. Configure Environment Variables

```bash
export LLM_PROVIDER=anthropic
export LLM_API_KEY=sk-ant-your-key-here
export LLM_MODEL=claude-3-5-haiku-20241022  # or claude-3-sonnet-20250214
```

### 3. Or Create `.env` File

```bash
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-your-key-here
LLM_MODEL=claude-3-5-haiku-20241022
```

### 4. Recommended Models

| Model | Context | Best For |
|-------|---------|----------|
| `claude-3-5-haiku-20241022` | 200K | Fast, lightweight |
| `claude-3-5-sonnet-20250214` | 200K | Balanced |
| `claude-3-opus-20240229` | 200K | Complex reasoning |

---

## Option 3: Ollama (Local, Free)

### 1. Install Ollama

```bash
# macOS
curl -fsSL https://ollama.com/install.sh | sh

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from https://ollama.com/download
```

### 2. Pull a Model

```bash
ollama pull llama3.2
```

### 3. Start Ollama Server

```bash
ollama serve
```

### 4. Configure Environment Variables

```bash
export LLM_PROVIDER=ollama
export LLM_BASE_URL=http://localhost:11434
export LLM_MODEL=llama3.2
```

### 5. Or Create `.env` File

```bash
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama3.2
```

### 6. Recommended Models

| Model | Size | RAM Required |
|-------|------|--------------|
| `llama3.2` | 2GB | 8GB |
| `mistral` | 4.1GB | 8GB |
| `codellama` | 3.8GB | 8GB |

---

## Quick Start by Provider

### OpenAI (Fastest Setup)

```bash
# One-line setup
export LLM_PROVIDER=openai LLM_API_KEY=sk-... LLM_MODEL=gpt-4o-mini

# Test it
memory-mesh reflect '{"topic": "test", "limit": 5}'
```

### Anthropic

```bash
export LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... LLM_MODEL=claude-3-5-haiku-20241022
```

### Ollama (No API Key Needed)

```bash
# Install & run
ollama pull llama3.2 && ollama serve &

# Configure
export LLM_PROVIDER=ollama LLM_MODEL=llama3.2

# Test it
memory-mesh reflect '{"topic": "test", "limit": 5}'
```

---

## Verification

Test your LLM setup:

```bash
# Should generate a reflection
memory-mesh reflect '{"topic": "test"}'
```

**Expected output:**
```json
{
  "status": "ok",
  "reflection": "Insight based on memories...",
  "confidence": 0.85,
  "id": "reflect_...",
  "topic": "test",
  "sourceMemoryCount": 2,
  "yamoBlock": "agent: MemoryMesh...",
  "createdAt": "2026-01-19T..."
}
```

---

## Troubleshooting

### Issue: "LLM API key not configured"

**Solution:** Ensure `LLM_API_KEY` environment variable is set before running commands.

```bash
echo $LLM_API_KEY  # Should show your key
```

### Issue: Ollama connection refused

**Solution:** Ensure Ollama server is running:

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama if not running
ollama serve
```

### Issue: Timeout errors

**Solution:** Increase timeout in code or use local Ollama:

```bash
# Ollama has no timeout (local inference)
export LLM_PROVIDER=ollama
```

---

## Cost Estimates

### OpenAI gpt-4o-mini

| Operations | Cost |
|------------|------|
| 1000 reflections | ~$0.10 |
| 10,000 reflections | ~$1.00 |

### Anthropic claude-3-5-haiku

| Operations | Cost |
|------------|------|
| 1000 reflections | ~$0.15 |
| 10,000 reflections | ~$1.50 |

### Ollama

| Operations | Cost |
|------------|------|
| Unlimited | **Free** (compute cost only) |

---

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use `.env` files** (add to `.gitignore`)
3. **Rotate keys regularly**
4. **Set appropriate usage limits** in your provider console
5. **Monitor usage** with `mesh.stats()` or provider dashboards

```bash
# Add to .gitignore
.env
.env.local
*.env
```
