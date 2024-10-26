const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
} = require("discord.js");
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const WebSocket = require("ws");

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static("public"));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const loadCharacters = () => {
    try {
        return JSON.parse(fs.readFileSync("public/characters.json"));
    } catch (error) {
        console.error("Error loading characters:", error);
        return [];
    }
};

const saveCharacters = (characters) => {
    try {
        fs.writeFileSync(
            "public/characters.json",
            JSON.stringify(characters, null, 2),
        );
    } catch (error) {
        console.error("Error saving characters:", error);
    }
};

const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws) => {
    console.log("Client connected");
    ws.on("close", () => console.log("Client disconnected"));
    ws.on("error", (error) => console.error("WebSocket error:", error));
});

const sendUpdate = (message) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
};

const isValidImageUrl = (url) => {
    const validImagePattern = /^(https?:\/\/.*\.(jpg|jpeg|png))$/i;
    return validImagePattern.test(url);
};

const commands = [
    {
        name: "create_character",
        description: "Creates a new character",
        options: [
            {
                type: 3,
                name: "name",
                description: "The name of the character to create",
                required: true,
            },
            {
                type: 3,
                name: "faceclaim",
                description: "The face claim of the character to create",
                required: true,
            },
            {
                type: 3,
                name: "image",
                description:
                    "The image URL of the character (jpg, jpeg, or png). Use a circle-image cropper",
                required: true,
            },
            {
                type: 3,
                name: "bio",
                description: "The character sheet of the character",
                required: true,
            },
            {
                type: 3,
                name: "password",
                description: "The password to edit/delete the character",
                required: true,
            },
        ],
    },
    {
        name: "edit_character",
        description: "Edits a character",
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
                description: "The new face claim of the character to edit",
                required: false,
            },
            {
                type: 3,
                name: "image",
                description:
                    "The new image URL of the character (jpg, jpeg, or png). Use a circle-image cropper",
                required: false,
            },
            {
                type: 3,
                name: "bio",
                description: "The new character sheet of the character",
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
        description: "Shows a character",
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
        console.log("Started refreshing application (/) commands.");
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
            body: commands,
        });
        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error(error);
    }
})();

client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
        const { commandName, options } = interaction;
        const characters = loadCharacters();

        if (
            commandName === "edit_character" ||
            commandName === "delete_character" ||
            commandName === "show_character"
        ) {
            const focusedValue = options.getFocused();
            const choices = characters
                .filter((character) =>
                    character.name
                        .toLowerCase()
                        .includes(focusedValue.toLowerCase()),
                )
                .map((character) => ({
                    name: character.name,
                    value: character.name,
                }));

            await interaction.respond(choices);
        }
        return;
    }

    if (!interaction.isCommand()) return;

    const { commandName } = interaction;
    const characters = loadCharacters();

    if (commandName === "create_character") {
        const name = interaction.options.getString("name");
        const faceclaim = interaction.options.getString("faceclaim");
        const image = interaction.options.getString("image");
        const bio = interaction.options.getString("bio");
        const password = interaction.options.getString("password");

        if (characters.find((c) => c.name === name)) {
            return await interaction.reply(
                `Character **${name}** already exists!`,
            );
        }

        if (image && !isValidImageUrl(image)) {
            return await interaction.reply(
                `Invalid image URL. Please provide a URL ending with .jpg, .jpeg, or .png.`,
            );
        }

        characters.push({
            name,
            faceclaim,
            image,
            bio,
            password,
        });

        saveCharacters(characters);
        sendUpdate({ action: "create", name, faceclaim, image, bio });
        await interaction.reply(`Character **${name}** created!`);
    } else if (commandName === "delete_character") {
        const name = interaction.options.getString("name");
        const password = interaction.options.getString("password");
        const characterIndex = characters.findIndex((c) => c.name === name);

        if (characterIndex !== -1) {
            const character = characters[characterIndex];
            if (character.password === password || password === "admin!") {
                characters.splice(characterIndex, 1);
                saveCharacters(characters);
                sendUpdate({ action: "delete", name });
                await interaction.reply(`Character **${name}** deleted!`);
            } else {
                await interaction.reply(
                    `Invalid password for character **${name}**.`,
                );
            }
        } else {
            await interaction.reply(`Character **${name}** not found!`);
        }
    } else if (commandName === "edit_character") {
        const name = interaction.options.getString("name");
        const faceclaim = interaction.options.getString("faceclaim");
        const image = interaction.options.getString("image");
        const bio = interaction.options.getString("bio");
        const password = interaction.options.getString("password");
        const character = characters.find((c) => c.name === name);

        if (character) {
            if (password === character.password || password === "admin!") {
                if (faceclaim) {
                    character.faceclaim = faceclaim;
                }
                if (image) {
                    if (!isValidImageUrl(image)) {
                        return await interaction.reply(
                            `Invalid image URL. Please provide a URL ending with .jpg, .jpeg, or .png.`,
                        );
                    }
                    character.image = image;
                }
                if (bio) {
                    character.bio = bio;
                }
                saveCharacters(characters);
                sendUpdate({ action: "edit", name });
                await interaction.reply(`Character **${name}** edited!`);
            } else {
                await interaction.reply(
                    `Invalid password for character **${name}**.`,
                );
            }
        } else {
            await interaction.reply(`Character **${name}** not found!`);
        }
    } else if (commandName === "show_character") {
        const name = interaction.options.getString("name");
        const character = characters.find((c) => c.name === name);

        if (character) {
            const bioUrlPattern = /^(https?:\/\/.*)/i;
            const bioDisplay = bioUrlPattern.test(character.bio)
                ? `[Character Sheet](${character.bio})`
                : "N/A";

            const embed = new EmbedBuilder()
                .setTitle(`**${character.name.toUpperCase()}**`)
                .setDescription(bioDisplay)
                .setImage(character.image || "")
                .setColor("#fffdd0")
                .setFooter({ text: `${character.faceclaim}` });

            await interaction.reply({ embeds: [embed] });
        } else {
            await interaction.reply(`Character **${name}** not found!`);
        }
    } else if (commandName === "list_all_characters") {
        if (characters.length === 0) {
            return await interaction.reply("No characters found.");
        }

        const characterListURL = "https://yourwebsite.com/characters";  // Replace with the actual URL

        await interaction.reply(`Click [here](${characterListURL}) to view the character list`);
    }
});

const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
    });
});

client.login(process.env.DISCORD_TOKEN);

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/library.html");
});
