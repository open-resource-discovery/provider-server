import { Command, Option } from "commander";

// Function to show help with clean defaults otherwise we would print Github-Token into the terminal
export function showCleanHelp(cmd: Command): void {
  const options = cmd.options;
  // Create a new command instance for displaying help
  const helpProgram = new Command();

  options.forEach((opt) => {
    const cleanOpt = new Option(opt.flags, opt.description);

    // Copy over choices if they exist
    if (opt.argChoices) {
      cleanOpt.choices(opt.argChoices);
    }

    // Add default for non-sensitive options only
    if (!["--github-token"].includes(opt.flags)) {
      cleanOpt.default(undefined);
    }

    helpProgram.addOption(cleanOpt);
  });

  helpProgram.addHelpText("before", "Loads and validates ORD documents and exposes them as an ORD Document API\n");

  helpProgram.help();
}
