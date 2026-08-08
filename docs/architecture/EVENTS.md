# Domain Events & Queue Jobs

## Domain events
Events describe business facts that already happened.

### User/Realtor
- USER_REGISTERED
- USER_VERIFIED
- REALTOR_VERIFIED
- USER_BLOCKED

### Property/Listing
- PROPERTY_CREATED
- PROPERTY_UPDATED
- PROPERTY_STATUS_CHANGED
- LISTING_CREATED
- LISTING_UPDATED
- LISTING_PRICE_CHANGED
- LISTING_DISAPPEARED
- LISTING_REAPPEARED

### Requests/Matches
- REQUEST_CREATED
- REQUEST_UPDATED
- REQUEST_VERIFIED
- REQUEST_EXPIRED
- REQUEST_CLOSED
- MATCH_CREATED
- MATCH_SCORE_CHANGED
- MATCH_STATUS_CHANGED

### Owner/Dedupe
- OWNER_CLASSIFIED
- OWNER_CONFIDENCE_CHANGED
- DUPLICATE_CANDIDATE_FOUND
- PROPERTIES_MERGED
- DUPLICATE_REJECTED

### Security/Audit
- CONTACT_REVEALED
- ROLE_CHANGED
- ADMIN_PRIVATE_DATA_ACCESSED

## Queue jobs
Jobs describe technical work to perform.
- PROCESS_RAW_LISTING
- NORMALIZE_LISTING
- CLASSIFY_OWNER
- FIND_DUPLICATE_CANDIDATES
- RUN_MATCHING_FOR_REQUEST
- RUN_MATCHING_FOR_LISTING
- SEND_NOTIFICATION
- PROCESS_IMAGE

## Reliability
Critical DB change + event scheduling should use an outbox pattern where loss of the event would create incorrect business state.

## Idempotency
Jobs and commands that may retry must have idempotency strategy. In particular Request+Listing cannot create duplicate active Match records.
