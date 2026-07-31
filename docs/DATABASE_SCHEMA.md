# Database Schema

## Overview

This document describes the initial Supabase-backed database architecture for IkiMetr. The schema is designed for a property marketplace workflow with user ownership, profile metadata, property records, and associated media.

## Core Entities

### 1. users

Stores authenticated user identity and account-level metadata.

- Primary key: `id` (UUID, references `auth.users`)
- Required fields: `email`, `created_at`, `updated_at`
- Optional fields: `display_name`, `avatar_url`, `is_active`
- Soft delete support: `deleted_at`
- Security: Row Level Security enabled with policies scoped to the authenticated user

### 2. profiles

Stores extended profile information for a user.

- Primary key: `id` (UUID)
- Foreign key: `user_id` → `users.id`
- Soft delete support: `deleted_at`
- Security: RLS enabled and scoped to the owning user

### 3. properties

Stores property listing data.

- Primary key: `id` (UUID)
- Foreign key: `owner_id` → `users.id`
- Soft delete support: `deleted_at`
- Security: RLS enabled with public visibility for published listings and owner-only write access

### 4. property_images

Stores media files for a property listing.

- Primary key: `id` (UUID)
- Foreign key: `property_id` → `properties.id`
- Soft delete support: `deleted_at`
- Security: RLS enabled with public read access for published properties and owner-only management

## Relationships

- `users` 1-to-1 `profiles`
- `users` 1-to-many `properties`
- `properties` 1-to-many `property_images`

## Design Principles

- UUID primary keys for global uniqueness.
- `created_at` and `updated_at` on every table.
- Soft delete via `deleted_at` instead of hard deletes.
- Indexes for ownership, visibility, and common lookup filters.
- Production-ready Row Level Security with baseline policies.

## Migration Files

- [supabase/migrations/20260731120000_create_users.sql](../supabase/migrations/20260731120000_create_users.sql)
- [supabase/migrations/20260731120001_create_profiles.sql](../supabase/migrations/20260731120001_create_profiles.sql)
- [supabase/migrations/20260731120002_create_properties.sql](../supabase/migrations/20260731120002_create_properties.sql)
- [supabase/migrations/20260731120003_create_property_images.sql](../supabase/migrations/20260731120003_create_property_images.sql)
