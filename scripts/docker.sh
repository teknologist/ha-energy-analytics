#!/usr/bin/env bash
#
# Docker Helper Script for Energy Dashboard
# Usage: ./scripts/docker.sh [command]
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to project root
cd "$PROJECT_ROOT"

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_env() {
    if [ ! -f .env ]; then
        log_warning ".env file not found. Creating from .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env
            log_info "Created .env file. Please update it with your configuration."
        else
            log_error ".env.example not found. Cannot create .env file."
            exit 1
        fi
    fi
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
}

# Use 'docker compose' or 'docker-compose' based on what's available
DOCKER_COMPOSE="docker compose"
if ! docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
fi

# Commands
cmd_dev() {
    log_info "Starting development environment..."
    check_env

    # Override NODE_ENV for development
    export NODE_ENV=development

    $DOCKER_COMPOSE up -d mongodb questdb
    log_success "MongoDB and QuestDB started"
    log_info "MongoDB: mongodb://localhost:27017/energy_dashboard"
    log_info "QuestDB Console: http://localhost:9000"
    log_info ""
    log_info "Run 'npm run dev' locally to start the API with hot reload"
}

cmd_prod() {
    log_info "Starting production environment..."
    check_env

    # Build the API image
    log_info "Building API image..."
    $DOCKER_COMPOSE build api

    # Start all services
    log_info "Starting all services..."
    $DOCKER_COMPOSE up -d

    log_success "All services started"
    log_info "API: http://localhost:${PORT:-3042}"
    log_info "Dashboard: http://localhost:${PORT:-3042}/dashboard"
    log_info "MongoDB: mongodb://localhost:27017/energy_dashboard"
    log_info "QuestDB Console: http://localhost:9000"
    log_info ""
    log_info "Run './scripts/docker.sh logs' to view logs"
}

cmd_down() {
    log_info "Stopping all services..."
    $DOCKER_COMPOSE down
    log_success "All services stopped"
}

cmd_logs() {
    local service="${1:-}"

    if [ -z "$service" ]; then
        log_info "Showing logs for all services (Ctrl+C to exit)..."
        $DOCKER_COMPOSE logs -f
    else
        log_info "Showing logs for $service (Ctrl+C to exit)..."
        $DOCKER_COMPOSE logs -f "$service"
    fi
}

cmd_clean() {
    log_warning "This will stop all services and remove containers and volumes!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Stopping and removing containers..."
        $DOCKER_COMPOSE down -v
        log_success "All containers and volumes removed"
    else
        log_info "Cancelled"
    fi
}

cmd_mongo() {
    log_info "Connecting to MongoDB shell..."

    if ! $DOCKER_COMPOSE ps mongodb | grep -q "Up"; then
        log_error "MongoDB container is not running"
        log_info "Start it with: ./scripts/docker.sh dev"
        exit 1
    fi

    docker exec -it energy-dashboard-mongodb mongosh energy_dashboard
}

cmd_questdb() {
    log_info "Opening QuestDB Console..."

    if ! $DOCKER_COMPOSE ps questdb | grep -q "Up"; then
        log_error "QuestDB container is not running"
        log_info "Start it with: ./scripts/docker.sh dev"
        exit 1
    fi

    log_info "QuestDB Console: http://localhost:9000"
    log_info "PostgreSQL: psql -h localhost -p 8812 -U admin -d qdb"

    # Try to open in browser
    if command -v open &> /dev/null; then
        open http://localhost:9000
    elif command -v xdg-open &> /dev/null; then
        xdg-open http://localhost:9000
    fi
}

cmd_status() {
    log_info "Service status:"
    $DOCKER_COMPOSE ps
}

cmd_restart() {
    local service="${1:-}"

    if [ -z "$service" ]; then
        log_info "Restarting all services..."
        $DOCKER_COMPOSE restart
        log_success "All services restarted"
    else
        log_info "Restarting $service..."
        $DOCKER_COMPOSE restart "$service"
        log_success "$service restarted"
    fi
}

cmd_rebuild() {
    log_info "Rebuilding API image..."
    $DOCKER_COMPOSE build --no-cache api
    log_success "API image rebuilt"

    log_info "Restarting API service..."
    $DOCKER_COMPOSE up -d --force-recreate api
    log_success "API service restarted with new image"
}

cmd_help() {
    cat <<EOF
Energy Dashboard - Docker Helper Script

Usage: ./scripts/docker.sh [command] [options]

Commands:
    dev         Start development environment (MongoDB + QuestDB only)
                Run 'npm run dev' locally for API hot reload

    prod        Start production environment (all services in Docker)

    down        Stop all services

    logs [svc]  View logs (optional: specify service name)
                Services: mongodb, questdb, api

    clean       Stop services and remove containers and volumes
                WARNING: This will delete all data!

    mongo       Connect to MongoDB shell

    questdb     Open QuestDB console (web browser)

    status      Show status of all services

    restart     Restart all services or specific service
                Example: ./scripts/docker.sh restart api

    rebuild     Rebuild and restart API service

    help        Show this help message

Examples:
    # Start development environment
    ./scripts/docker.sh dev
    npm run dev

    # Start production environment
    ./scripts/docker.sh prod

    # View API logs
    ./scripts/docker.sh logs api

    # Connect to MongoDB
    ./scripts/docker.sh mongo

    # Clean everything
    ./scripts/docker.sh clean

Environment Variables:
    Configure in .env file (created from .env.example on first run)
    - PORT: API port (default: 3042)
    - HA_URL: Home Assistant URL
    - HA_TOKEN: Home Assistant access token
    - And more...

EOF
}

# Main script
main() {
    # Check Docker installation
    check_docker

    # Parse command
    local command="${1:-help}"
    shift || true

    case "$command" in
        dev)
            cmd_dev "$@"
            ;;
        prod)
            cmd_prod "$@"
            ;;
        down)
            cmd_down "$@"
            ;;
        logs)
            cmd_logs "$@"
            ;;
        clean)
            cmd_clean "$@"
            ;;
        mongo)
            cmd_mongo "$@"
            ;;
        questdb)
            cmd_questdb "$@"
            ;;
        status)
            cmd_status "$@"
            ;;
        restart)
            cmd_restart "$@"
            ;;
        rebuild)
            cmd_rebuild "$@"
            ;;
        help|--help|-h)
            cmd_help
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            cmd_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
