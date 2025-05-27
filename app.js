
require('dotenv').config();

// Import necessary modules
const express = require('express');
const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors'); // Middleware for Cross-Origin Resource Sharing

// Initialize Express application
const app = express();
const port = process.env.PORT || 3000; // Use port from .env or default to 3000

// Middleware setup
app.use(express.json()); // Enable parsing of JSON request bodies
// Enable CORS for all origins. In a production environment, you should restrict this
// to only your frontend's domain for security. Example: cors({ origin: 'http://yourfrontend.com' })
app.use(cors());

// MongoDB Connection Setup
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const mongoClient = new MongoClient(mongoUri);
let db; // This variable will hold our connected database instance

/**
 * Connects to the MongoDB database.
 * This function is called once when the server starts.
 */
async function connectToMongoDB() {
    try {
        await mongoClient.connect();
        db = mongoClient.db(dbName);
        console.log("Successfully connected to MongoDB Atlas!");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        // Exit the process if database connection fails, as the app cannot function without it
        process.exit(1);
    }
}

// Google Gemini AI Setup
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
    console.error("GEMINI_API_KEY is not set in the .env file.");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

/**
 * Helper function to safely parse JSON-like strings that might have single quotes
 * or unquoted keys into valid JSON objects.
 * @param {string} argString - The string argument from the MongoDB command.
 * @returns {object} The parsed JavaScript object.
 * @throws {Error} If parsing fails even after corrections.
 */
function parseMongoArgs(argString) {
    if (!argString) return {};
    try {
        // First try to parse directly (if it's already perfect JSON)
        return JSON.parse(argString);
    } catch (e) {
        // If direct parse fails, try to convert single quotes to double quotes
        // and add quotes to unquoted keys.
        // This is still fragile and not foolproof for all edge cases or complex JS expressions.
        let correctedString = argString
            // Replace 'key': with "key": (for keys that are quoted with single quotes)
            .replace(/(['"])?([a-zA-Z0-9_$]+)(['"])?:/g, '"$2":')
            // Replace 'value' with "value" (for string values quoted with single quotes)
            .replace(/'([^']+)'/g, '"$1"');

        try {
            return JSON.parse(correctedString);
        } catch (e2) {
            console.error("Failed to parse argument string even after correction:", argString, e2);
            throw new Error(`Invalid JSON syntax for MongoDB argument: ${argString}`);
        }
    }
}

/**
 * Main API endpoint for the MongoDB AI Agent.
 * Receives natural language queries, sends them to Gemini,
 * and attempts to execute the generated MongoDB command.
 */
app.post('/api/mongo-ai', async (req, res) => {
    const userQuery = req.body.query;

    if (!userQuery) {
        return res.status(400).json({ error: "Query parameter is required in the request body." });
    }

    console.log(`Received query: "${userQuery}"`);

    try {
        const prompt = `You are a MongoDB shell command generator. Your task is to convert natural language queries into valid MongoDB shell commands.
        When generating JSON objects for queries, updates, or inserts, ensure all keys and string values are enclosed in DOUBLE QUOTES (").
        Respond ONLY with the MongoDB shell command. Do not include any conversational text, explanations, or markdown formatting (like triple backticks).
        
        Examples:
        User: "Find all users in the 'users' collection."
        mongo-ai: db.users.find({})
        
        User: "Insert a new document into 'products' collection with name 'Laptop' and price 1200."
        mongo-ai: db.products.insertOne({"name": "Laptop", "price": 1200})
        
        User: "Update all documents in 'orders' collection where status is 'pending' to 'shipped'."
        mongo-ai: db.orders.updateMany({"status": "pending"}, {"$set": {"status": "shipped"}})
        
        User: "Delete the document from 'logs' collection where level is 'debug'."
        mongo-ai: db.logs.deleteOne({"level": "debug"})

        User: "Create an index on the 'name' field in the 'users' collection."
        mongo-ai: db.users.createIndex({"name": 1})

        User: "Count documents in 'customers' collection."
        mongo-ai: db.customers.countDocuments({})

        User: "Group users by city and count them in 'users' collection."
        mongo-ai: db.users.aggregate([ {"$group": {"_id": "$city", "count": {"$sum": 1}}} ])

        User: "Get all data from the users collection and copy to prachi_info collection."
        mongo-ai: db.users.aggregate([{"$out": "prachi_info"}])

        User: "Create a new collection called 'myNewCollection'."
        mongo-ai: db.createCollection("myNewCollection")

        User: "Show all collections."
        mongo-ai: db.listCollections().toArray()

        User: "Drop the current database."
        mongo-ai: db.dropDatabase()
        
        Now, convert the following user query: "${userQuery}"`;

        // Send prompt to Gemini
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let generatedMongoCommand = response.text().trim();

        console.log(`Generated MongoDB Command: "${generatedMongoCommand}"`);

        let dbResult;
        let collectionName = null; // Will be null for db-level operations
        let operationType;
        let argsString;

        // --- PARSING LOGIC: Prioritize direct 'db.' methods ---
        const dbLevelMatch = generatedMongoCommand.match(/^db\.(\w+)\((.*)\)$/);

        if (dbLevelMatch) {
            // It's a method directly on the 'db' object (e.g., db.createCollection)
            operationType = dbLevelMatch[1];
            argsString = dbLevelMatch[2];

            try {
                switch (operationType) {
                    case 'createCollection':
                        let newCollectionName;
                        let collectionOptions = {};
                        // Split by comma, but not inside objects for createCollection options
                        const createCollectionArgs = argsString.split(/,(?![^{]*})/);
                        if (createCollectionArgs.length > 0) {
                            newCollectionName = JSON.parse(createCollectionArgs[0].trim()); // Should be a string
                            if (typeof newCollectionName !== 'string') {
                                throw new Error("Collection name must be a string (e.g., 'myCollection').");
                            }
                            if (createCollectionArgs.length > 1) {
                                collectionOptions = parseMongoArgs(createCollectionArgs[1].trim());
                            }
                        } else {
                            throw new Error("Missing collection name for createCollection.");
                        }
                        const createdCollection = await db.createCollection(newCollectionName, collectionOptions);
                        // Sanitize result to prevent circular JSON error
                        dbResult = {
                            acknowledged: true,
                            collectionName: createdCollection.collectionName,
                            message: `Collection '${createdCollection.collectionName}' created successfully.`
                        };
                        break;

                    case 'dropDatabase':
                        // dropDatabase returns a simple object like { ok: 1 }
                        dbResult = await db.dropDatabase();
                        break;

                    case 'listCollections':
                        let listCollectionsFilter = {};
                        if (argsString.trim() !== '') {
                            listCollectionsFilter = parseMongoArgs(argsString.trim());
                        }
                        // .toArray() converts the cursor to a plain array of objects
                        const collectionsArray = await db.listCollections(listCollectionsFilter).toArray();
                        // Optional: further sanitize if collection info has complex objects
                        dbResult = collectionsArray.map(coll => ({
                            name: coll.name,
                            type: coll.type,
                            options: coll.options
                        }));
                        break;

                    case 'runCommand': // For more advanced direct commands
                        let commandDoc = {};
                        try {
                            commandDoc = parseMongoArgs(argsString.trim());
                        } catch (e) {
                            throw new Error(`Invalid JSON for runCommand document: ${e.message}`);
                        }
                        dbResult = await db.runCommand(commandDoc);
                        break;

                    // Add other db-level operations here as needed (e.g., stats, currentOp)
                    default:
                        throw new Error(`Unsupported direct 'db.' operation: ${operationType}`);
                }
            } catch (dbError) {
                console.error(`MongoDB execution error for db-level operation ${operationType}:`, dbError);
                dbResult = { error: `MongoDB operation failed: ${dbError.message}` };
            }

        } else {
            // 2. If not a db-level command, try to match collection-level commands
            const collectionLevelMatch = generatedMongoCommand.match(/^db\.(\w+)\.(\w+)\((.*)\)$/);

            if (collectionLevelMatch) {
                collectionName = collectionLevelMatch[1];
                operationType = collectionLevelMatch[2];
                argsString = collectionLevelMatch[3];
                const collection = db.collection(collectionName);

                try {
                    switch (operationType) {
                        case 'find':
                            let findQuery = {};
                            if (argsString.trim() !== '') {
                                findQuery = parseMongoArgs(argsString.split(/,(?![^{]*})/)[0].trim()); // Only take the first arg for find
                            }
                            dbResult = await collection.find(findQuery).limit(5).toArray(); // Limit results for safety in demo
                            break;

                        case 'insertOne':
                            dbResult = await collection.insertOne(parseMongoArgs(argsString.trim()));
                            break;

                        case 'updateMany':
                        case 'updateOne':
                            const updateArgs = argsString.split(/,(?![^{]*})/); // Split by comma, but not inside curly braces
                            if (updateArgs.length < 2) throw new Error("Invalid arguments for update operation.");
                            
                            let filter = parseMongoArgs(updateArgs[0].trim());
                            let update = parseMongoArgs(updateArgs[1].trim());

                            if (operationType === 'updateMany') {
                                dbResult = await collection.updateMany(filter, update);
                            } else {
                                dbResult = await collection.updateOne(filter, update);
                            }
                            break;

                        case 'deleteOne':
                        case 'deleteMany':
                            dbResult = await (operationType === 'deleteOne' ? collection.deleteOne : collection.deleteMany)(parseMongoArgs(argsString.trim()));
                            break;

                        case 'createIndex':
                            dbResult = await collection.createIndex(parseMongoArgs(argsString.split(/,(?![^{]*})/)[0].trim()));
                            break;

                        case 'countDocuments':
                            let countQuery = {};
                            if (argsString.trim() !== '') {
                                countQuery = parseMongoArgs(argsString.trim());
                            }
                            dbResult = await collection.countDocuments(countQuery);
                            break;

                        case 'aggregate':
                            let pipeline = [];
                            try {
                            
                                pipeline = JSON.parse(argsString.trim());
                                
                                if (!Array.isArray(pipeline)) {
                                    throw new Error("Aggregation pipeline must be an array of stages.");
                                }
                            } catch (e) {
                                throw new Error(`Invalid JSON for aggregation pipeline: ${e.message}`);
                            }
                            dbResult = await collection.aggregate(pipeline).toArray();
                            break;

                
                        default:
                            throw new Error(`Unsupported MongoDB collection operation: ${operationType}`);
                    }
                } catch (dbError) {
                    console.error(`MongoDB execution error for ${operationType} on ${collectionName}:`, dbError);
                    dbResult = { error: `MongoDB operation failed: ${dbError.message}` };
                }
            } else {
                // If neither db-level nor collection-level regex matched
                dbResult = { error: "Could not parse generated MongoDB command. It might be malformed or an unsupported operation type.", command: generatedMongoCommand };
            }
        }

        // 3. Send results back to the frontend
        res.json({
            userQuery: userQuery,
            generatedCommand: generatedMongoCommand,
            dbResult: dbResult
        });

    } catch (error) {
        console.error("Error in AI processing or command execution:", error);
        res.status(500).json({ error: "Failed to process query with AI or execute MongoDB command.", details: error.message });
    }
});

// Start the server after successfully connecting to MongoDB
connectToMongoDB().then(() => {
    app.listen(port, () => {
        console.log(`Backend server listening at http://localhost:${port}`);
    });
});