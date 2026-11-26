const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

const { TOKEN, CLIENT_ID, GUILD_ID } = process.env;
console.log("TOKEN length:", TOKEN ? TOKEN.length : "MISSING");
console.log("CLIENT_ID:", CLIENT_ID ? "set" : "MISSING");
console.log("GUILD_ID:", GUILD_ID ? "set" : "MISSING");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Define your slash commands here
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is alive"),

  new SlashCommandBuilder()
    .setName("about")
    .setDescription("Learn about Project Select"),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Make the bot say something")
    .addStringOption((o) =>
      o.setName("text").setDescription("What to say").setRequired(true)
    ),
];

// Register the commands when the bot starts
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Slash commands registered");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

// Handle the commands
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    return interaction.reply(`Pong! ${client.ws.ping}ms`);
  }

  if (interaction.commandName === "about") {
    const embed = new EmbedBuilder()
      .setTitle("Project Select")
      .setDescription(
        "A universal script hub for Arsenal, Phantom Forces, MM2, Rivals and Universal, with an AI config assistant. Join the Discord to be selected as a beta tester."
      )
      .setColor(0xff3b4e);
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === "say") {
    const text = interaction.options.getString("text");
    return interaction.reply({ content: text, allowedMentions: { parse: [] } });
  }
});

client.login(TOKEN);
