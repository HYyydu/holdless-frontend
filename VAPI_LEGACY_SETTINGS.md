## Legacy Vapi call configuration (now disabled)

This project previously supported outbound calls via **Vapi** in addition to the GPT-4o Realtime call backend.  
The runtime Vapi code has been removed; these settings are kept here only for reference.

### Old environment variables

```env
# Vapi (legacy – no longer used)
VAPI_API_KEY=your-vapi-api-key
VAPI_PHONE_NUMBER_ID=your-phone-number-id
VAPI_SERVER_URL=https://your-ngrok-url   # optional; for live transcript webhook

# Optional timeout
VAPI_TIMEOUT_MS=15000
```

The holdless backend now uses **only** the GPT-4o Realtime call backend, configured via:

```env
CALL_BACKEND_URL=http://localhost:4000
CALL_API_TOKEN=your-jwt-token
```

