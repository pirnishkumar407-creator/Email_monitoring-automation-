#!/bin/bash
echo "Starting AI Email Automation..."
echo ""
echo "Starting Node.js API server..."
node backend/server.js &
SERVER_PID=$!
sleep 2

echo "Running background AI Email Agent..."
python3 -u backend/agent.py

echo ""
echo "Server is running. Open http://localhost:3000 in your browser."
wait $SERVER_PID
