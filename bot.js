const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
} = require("discord.js");
const express = require("express");
const bodyParser = require("body-parser");
const WebSocket = require("ws");
const db = require('./db');
require('dotenv').config();

const MAX_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 300;
const MIN_PASSWORD_LENGTH = 8;
const MAX_FACECLAIM_LENGTH = 100;

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static("public", {
    maxAge: '1d'
}));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    failIfNotExists: false,
    retryLimit: 3
});

const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws) => {
    console.log("Client connected");
    
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    ws.on("close", () => {
        ws.isAlive = false;
        console.log("Client disconnected");
    });
    ws.on("error", (error) => console.error("WebSocket error:", error));
});

setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

const sendUpdate = (message) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
};

const isValidImageUrl = (url) => {
    if (!url) return false;
    const validImagePattern = /^https:\/\/.*\.(jpg|jpeg|png)$/i;
    return validImagePattern.test(url) && url.length <= 2048;
};

const validateCharacterInput = ({ name, faceclaim, bio, password }) => {
    const errors = [];
    
    if (!name || name.length > MAX_NAME_LENGTH) {
        errors.push(`Name must be between 1 and ${MAX_NAME_LENGTH} characters`);
    }
    
    if (!faceclaim || faceclaim.length > MAX_FACECLAIM_LENGTH) {
        errors.push(`Face claim must be between 1 and ${MAX_FACECLAIM_LENGTH} characters`);
    }
    
    if (bio && bio.length > MAX_BIO_LENGTH) {
        errors.push(`Bio must not exceed ${MAX_BIO_LENGTH} characters`);
    }
    
    if (password && password.length < MIN_PASSWORD_LENGTH) {
        errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    
    return errors;
};

const commands = [
    {
        name: "create_character",
        description: "Creates a new character profile",
        options: [
            {
                type: 3,
                name: "name",
                description: `Character name (max ${MAX_NAME_LENGTH} chars)`,
                required: true,
            },
            {
                type: 3,
                name: "faceclaim",
                description: "Character's face claim (actor/model name)",
                required: true,
            },
            {
                type: 3,
                name: "image",
                description: "Character image URL (HTTPS, jpg/png only)",
                required: true,
            },
            {
                type: 3,
                name: "bio",
                description: `Character sheet link (max ${MAX_BIO_LENGTH} chars)`,
                required: true,
            },
            {
                type: 3,
                name: "password",
                description: `Password for future edits (min ${MIN_PASSWORD_LENGTH} chars)`,
                required: true,
            },
        ],
    },
    {
        name: "edit_character",
        description: "Edits an existing character",
        options: [
            {
                type: 3,
                name: "name",
                description: "The name of the character to edit",
                required: true,
                autocomplete: true,
            },
            {
                type: 3,
                name: "password",
                description: "The password to edit the character",
                required: true,
            },
            {
                type: 3,
                name: "faceclaim",
                description: "New face claim (optional)",
                required: false,
            },
            {
                type: 3,
                name: "image",
                description: "New image URL (HTTPS, jpg/png only)",
                required: false,
            },
            {
                type: 3,
                name: "bio",
                description: `New sheet link (max ${MAX_BIO_LENGTH} chars)`,
                required: false,
            }
        ],
    },
    {
        name: "delete_character",
        description: "Deletes a character",
        options: [
            {
                type: 3,
                name: "name",
                description: "The name of the character to delete",
                required: true,
                autocomplete: true,
            },
            {
                type: 3,
                name: "password",
                description: "The password to delete the character",
                required: true,
            },
        ],
    },
    {
        name: "show_character",
        description: "Shows a character's profile",
        options: [
            {
                type: 3,
                name: "name",
                description: "The name of the character to show",
                required: true,
                autocomplete: true,
            },
        ],
    },
    {
        name: "list_all_characters",
        description: "Shows the list of all characters",
    },
];

const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log("Registering slash commands...");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
            body: commands,
        });
        console.log("✓ Slash commands registered successfully");
    } catch (error) {
        console.error("Failed to register slash commands:", error);
        process.exit(1);
    }
})();

// Command handling
client.on("ready", () => {
    console.log(`✓ Bot logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
        try {
            const { commandName, options } = interaction;
            const focusedValue = options.getFocused();

            if (["edit_character", "delete_character", "show_character"].includes(commandName)) {
                const characters = await db.searchCharacters(focusedValue);
                const choices = characters.slice(0, 10).map(character => ({
                    name: character.name,
                    value: character.name,
                }));

                await interaction.respond(choices);
            }
        } catch (error) {
            console.error("Autocomplete error:", error);
            await interaction.respond([]);
        }
        return;
    }

    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === "create_character") {
            const name = interaction.options.getString("name")?.trim();
            const faceclaim = interaction.options.getString("faceclaim")?.trim();
            const image = interaction.options.getString("image")?.trim();
            const bio = interaction.options.getString("bio")?.trim();
            const password = interaction.options.getString("password");

            const validationErrors = validateCharacterInput({
                name,
                faceclaim,
                bio,
                password
            });

            if (validationErrors.length > 0) {
                return await interaction.reply({
                    content: `❌ Validation failed:\n${validationErrors.join("\n")}`,
                    ephemeral: true
                });
            }

            if (await db.getCharacter(name)) {
                return await interaction.reply({
                    content: `❌ A character named "${name}" already exists!`,
                    ephemeral: true
                });
            }

            if (!isValidImageUrl(image)) {
                return await interaction.reply({
                    content: "❌ Invalid image URL. Please provide an HTTPS URL ending with .jpg, .jpeg, or .png.",
                    ephemeral: true
                });
            }

            await db.createCharacter({ name, faceclaim, image, bio, password });
            sendUpdate({ action: "create", name, faceclaim, image, bio });
            await interaction.reply(`✓ Character "${name}" has been created successfully!`);

        } else if (commandName === "edit_character") {
            const name = interaction.options.getString("name")?.trim();
            const faceclaim = interaction.options.getString("faceclaim")?.trim();
            const image = interaction.options.getString("image")?.trim();
            const bio = interaction.options.getString("bio")?.trim();
            const password = interaction.options.getString("password");

            if (faceclaim && faceclaim.length > MAX_FACECLAIM_LENGTH) {
                return await interaction.reply({
                    content: `❌ Face claim must not exceed ${MAX_FACECLAIM_LENGTH} characters`,
                    ephemeral: true
                });
            }

            if (bio && bio.length > MAX_BIO_LENGTH) {
                return await interaction.reply({
                    content: `❌ Bio must not exceed ${MAX_BIO_LENGTH} characters`,
                    ephemeral: true
                });
            }

            if (image && !isValidImageUrl(image)) {
                return await interaction.reply({
                    content: "❌ Invalid image URL. Please provide an HTTPS URL ending with .jpg, .jpeg, or .png.",
                    ephemeral: true
                });
            }

            const updated = await db.editCharacter({
                name,
                faceclaim,
                image,
                bio,
                password
            });

            if (updated) {
                sendUpdate({ action: "edit", name });
                await interaction.reply(`✓ Character "${name}" has been updated!`);
            } else {
                await interaction.reply({
                    content: `❌ Unable to update "${name}". Please check the password and try again.`,
                    ephemeral: true
                });
            }

        } else if (commandName === "delete_character") {
            const name = interaction.options.getString("name")?.trim();
            const password = interaction.options.getString("password");

            const deleted = await db.deleteCharacter(name, password);
            
            if (deleted) {
                sendUpdate({ action: "delete", name });
                await interaction.reply(`✓ Character "${name}" has been deleted.`);
            } else {
                await interaction.reply({
                    content: `❌ Unable to delete "${name}". Please check the password and try again.`,
                    ephemeral: true
                });
            }

        } else if (commandName === "show_character") {
            const name = interaction.options.getString("name")?.trim();
            const character = await db.getCharacter(name);

            if (!character) {
                return await interaction.reply({
                    content: `❌ Character "${name}" not found.`,
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(character.name.toUpperCase())
                .setDescription(character.bio.startsWith('http') ? 
                    `[Character Sheet](${character.bio})` : character.bio)
                .setImage(character.image || "")
                .setColor("#fffdd0")
                .setFooter({ text: character.faceclaim })

            await interaction.reply({ embeds: [embed] });

        } else if (commandName === "list_all_characters") {
            const characters = await db.getAllCharacters();
            
            if (characters.length === 0) {
                return await interaction.reply({
                    content: "No characters found in the database.",
                    ephemeral: true
                });
            }

            const characterListURL = "https://shield-database.onrender.com/";
            await interaction.reply(`📚 View the complete character list [here](${characterListURL})`);
        }
    } catch (error) {
        console.error("Command error:", error);
        await interaction.reply({
            content: "❌ An error occurred while processing your request. Please try again later.",
            ephemeral: true
        });
    }
});

const server = app.listen(port, () => {
    console.log(`✓ Server running on port ${port}`);
}).on('error', (error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
});

server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
    });
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("Failed to login to Discord:", error);
    process.exit(1);
});

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

app.get("/api/characters", async (req, res) => {
    try {
        const characters = await db.getAllCharacters();
        res.json(characters);
    } catch (error) {
        console.error("Failed to fetch characters:", error);
        res.status(500).json({ 
            error: "Internal server error",
            message: "Failed to fetch characters" 
        });
    }
});