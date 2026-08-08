# Requests Module

## Purpose
Represent structured demand from a realtor/client.

## Core fields
Transaction type, property type, geography, price range, room range, area range, floor preferences, renovation, structured constraints and free-text requirements.

## Lifecycle
ACTIVE → NEEDS_VERIFICATION → CLOSED_SUCCESS / CLOSED_NO_RESULT / EXPIRED.

## Rules
- client_id may be optional;
- stale request is excluded from normal matching;
- private client contact is not part of matching payload.
