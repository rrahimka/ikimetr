# Database ER Diagram

```mermaid
erdiagram
  users {
    uuid id PK
    text email
    text display_name
    text avatar_url
    boolean is_active
    timestamptz deleted_at
    timestamptz created_at
    timestamptz updated_at
  }

  profiles {
    uuid id PK
    uuid user_id FK
    text first_name
    text last_name
    text phone
    text bio
    text locale
    timestamptz deleted_at
    timestamptz created_at
    timestamptz updated_at
  }

  properties {
    uuid id PK
    uuid owner_id FK
    text title
    text description
    text address_line_1
    text address_line_2
    text city
    text state
    text postal_code
    text country
    numeric price
    text currency
    integer bedrooms
    integer bathrooms
    integer square_feet
    text property_type
    boolean is_public
    timestamptz deleted_at
    timestamptz created_at
    timestamptz updated_at
  }

  property_images {
    uuid id PK
    uuid property_id FK
    text file_name
    text file_url
    text caption
    boolean is_primary
    timestamptz deleted_at
    timestamptz created_at
    timestamptz updated_at
  }

  users ||--o{ properties : owns
  users ||--|| profiles : has
  properties ||--o{ property_images : contains
```