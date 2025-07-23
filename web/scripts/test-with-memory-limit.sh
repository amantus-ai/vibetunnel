#!/bin/bash

# Script to run tests with memory limits and cleanup

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running tests with memory limits...${NC}"

# Kill any leftover processes on test ports
echo -e "${YELLOW}Cleaning up any leftover test processes...${NC}"
for port in 3000 3001 3002 3003 3004 3005; do
  PID=$(lsof -ti:$port 2>/dev/null)
  if [ ! -z "$PID" ]; then
    echo -e "${RED}Killing process $PID on port $port${NC}"
    kill -9 $PID 2>/dev/null
  fi
done

# Run tests with memory limit and garbage collection enabled
echo -e "${GREEN}Starting tests with 4GB memory limit...${NC}"
NODE_OPTIONS='--max-old-space-size=4096 --expose-gc' npm test "$@"

# Clean up after tests
echo -e "${YELLOW}Cleaning up after tests...${NC}"
for port in 3000 3001 3002 3003 3004 3005; do
  PID=$(lsof -ti:$port 2>/dev/null)
  if [ ! -z "$PID" ]; then
    echo -e "${RED}Killing leftover process $PID on port $port${NC}"
    kill -9 $PID 2>/dev/null
  fi
done

echo -e "${GREEN}Test run complete${NC}"