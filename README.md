# MongoDB AI Agent

A natural language interface for MongoDB operations that allows you to perform database operations using simple English commands.

## Features

- Natural language query processing for MongoDB operations
- Supports operations like find, update, delete, and insert
- Case-insensitive matching
- Handles numeric and string values
- Proper error handling and feedback


### Find Operations
```
get users with email:user@example.com
get users with name :xyz
```

### Update Operations
```
update name of users to John Doe where email is user@example.com
```

### Delete Operations
```
delete age from users where name equals John
```

### Insert Operations
```
insert users with email: "user@example.com", name: "John Doe", credits_balance: 50
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Betusrivastava/mongodb-ai-agent
```

2. Install dependencies:
```bash
cd mongodb-agent
npm install
```

3. Configure MongoDB connection:
   - Create a `.env` file in the root directory
   - Add your MongoDB connection string:
   ```
   MONGODB_URI=your_connection_string_here,
   DB_NAME= your_database_name,
   GEMINI_API_KEY= your_gemini_key,
   PORT = default 3000
   ```

## Usage

Run the agent:
```bash
node app.js
```

Then enter your queries in natural language format.

## Error Handling

The agent provides helpful error messages and suggestions when:
- Query syntax is incorrect
- Required fields are missing
- Invalid data types are provided
- Documents are not found

## Dependencies

- MongoDB Node.js Driver
- Node.js v14 or higher
