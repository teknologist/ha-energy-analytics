#!/usr/bin/env bash
#
# Docker Setup Validation Script
# Tests the Docker configuration before deployment
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    log_success "Docker is installed"

    # Check Docker Compose
    if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    log_success "Docker Compose is installed"

    # Check Docker is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
    log_success "Docker daemon is running"
}

# Validate Docker files
check_docker_files() {
    log_info "Checking Docker configuration files..."

    local files=(
        "docker-compose.yml"
        "docker/Dockerfile.api"
        ".dockerignore"
        "scripts/docker.sh"
    )

    for file in "${files[@]}"; do
        if [ ! -f "$file" ]; then
            log_error "Missing file: $file"
            exit 1
        fi
        log_success "Found $file"
    done
}

# Validate environment configuration
check_environment() {
    log_info "Checking environment configuration..."

    if [ ! -f ".env" ]; then
        log_warning ".env file not found"
        if [ -f ".env.example" ]; then
            log_info "Creating .env from .env.example"
            cp .env.example .env
            log_warning "Please update .env with your configuration"
        else
            log_error ".env.example not found"
            exit 1
        fi
    else
        log_success ".env file exists"
    fi

    # Check for required variables
    source .env

    local required_vars=(
        "PORT"
        "HA_URL"
        "HA_TOKEN"
        "MONGODB_URI"
        "QUESTDB_HOST"
    )

    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_warning "$var is not set in .env"
        else
            log_success "$var is configured"
        fi
    done
}

# Test Docker Compose configuration
test_docker_compose() {
    log_info "Testing Docker Compose configuration..."

    if docker compose config &> /dev/null; then
        log_success "docker-compose.yml is valid"
    else
        log_error "docker-compose.yml has errors"
        docker compose config
        exit 1
    fi
}

# Test Dockerfile syntax
test_dockerfile() {
    log_info "Testing Dockerfile syntax..."

    # Docker build dry-run isn't directly available, but we can check basic syntax
    if grep -q "^FROM" docker/Dockerfile.api && grep -q "^WORKDIR" docker/Dockerfile.api; then
        log_success "Dockerfile has basic structure"
    else
        log_error "Dockerfile appears malformed"
        exit 1
    fi
}

# Build test
test_build() {
    log_info "Testing Docker image build..."
    log_warning "This will build the API image (may take several minutes)"

    read -p "Continue with build test? (y/N): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Skipping build test"
        return
    fi

    if docker compose build api; then
        log_success "API image built successfully"
    else
        log_error "Failed to build API image"
        exit 1
    fi
}

# Service health test
test_services() {
    log_info "Testing service startup..."
    log_warning "This will start all services"

    read -p "Continue with service test? (y/N): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Skipping service test"
        return
    fi

    log_info "Starting services..."
    docker compose up -d

    log_info "Waiting for services to be healthy (30s timeout)..."
    local timeout=30
    local elapsed=0

    while [ $elapsed -lt $timeout ]; do
        if docker compose ps | grep -q "healthy"; then
            log_success "Services are healthy"

            # Test endpoints
            log_info "Testing API health endpoint..."
            sleep 5  # Give a bit more time

            if curl -f http://localhost:${PORT:-3042}/api/health &> /dev/null; then
                log_success "API health endpoint responded"
            else
                log_warning "API health endpoint not responding yet"
            fi

            docker compose down
            return
        fi

        sleep 2
        ((elapsed+=2))
    done

    log_error "Services did not become healthy in time"
    log_info "Service status:"
    docker compose ps
    log_info "Logs:"
    docker compose logs --tail=50

    docker compose down
    exit 1
}

# Network test
test_network() {
    log_info "Testing Docker network configuration..."

    if docker compose config | grep -q "energy-network"; then
        log_success "Network configuration found"
    else
        log_error "Network configuration missing"
        exit 1
    fi
}

# Volume test
test_volumes() {
    log_info "Testing Docker volume configuration..."

    local volumes=(
        "mongodb_data"
        "questdb_data"
    )

    for vol in "${volumes[@]}"; do
        if docker compose config | grep -q "$vol"; then
            log_success "Volume $vol configured"
        else
            log_error "Volume $vol not configured"
            exit 1
        fi
    done
}

# Main
main() {
    echo "Docker Setup Validation"
    echo "======================="
    echo ""

    check_prerequisites
    echo ""

    check_docker_files
    echo ""

    check_environment
    echo ""

    test_docker_compose
    echo ""

    test_dockerfile
    echo ""

    test_network
    echo ""

    test_volumes
    echo ""

    # Optional tests
    if [ "${1:-}" == "--full" ]; then
        test_build
        echo ""

        test_services
        echo ""
    else
        log_info "Run with --full flag to test build and service startup"
        log_info "Example: $0 --full"
        echo ""
    fi

    log_success "All validation checks passed!"
    echo ""
    log_info "Next steps:"
    echo "  1. Review and update .env file with your configuration"
    echo "  2. Run './scripts/docker.sh dev' to start development environment"
    echo "  3. Run './scripts/docker.sh prod' to start production environment"
}

main "$@"
