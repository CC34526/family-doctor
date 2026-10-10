# Family Doctor

A private household chatbot. Questions go to OpenAI with your own API key. The key stays on this computer.

This is not a clinician, a diagnosis, or a medical record. For trouble breathing, chest pain, stroke signs, a seizure, heavy bleeding, a limp or unresponsive child, or thoughts of suicide, call emergency services. In the United States, call 911. For a mental health crisis, call or text 988.

## Run it

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173 and paste an API key from [OpenAI](https://platform.openai.com/api-keys).

Choose **Remember** to store the key in `.env` on this machine. That file is ignored by git. You can also copy `.env.example` to `.env` and fill in `OPENAI_API_KEY` before starting.

## Model

The default model is the current ChatGPT model (`chat-latest`). OpenAI shut down `gpt-5-chat-latest`. The setup screen can also switch to `gpt-5.6-sol` or `gpt-5.6-luna`. To pick any other model, set `OPENAI_MODEL` in `.env` and restart.

`OPENAI_REASONING_EFFORT` defaults to `low` for reasoning models. ChatGPT does not use it.

## Privacy

The visit transcript is saved in this browser only. Each question is sent to OpenAI. Do not type details you would not want sent there.
