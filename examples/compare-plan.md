# Compare script

We need a way to run a bunch of example inputs through purify across all output modes and save the results so we can look at them side by side. The goal is to understand how different modes and models affect output quality, not to automate any kind of regression testing.

The script lives at `scripts/compare.sh`. You run it from the repo root. With no arguments it processes everything in `examples/`. You can also give it specific files if you want to run a subset.

For each input file, the script runs purify six times — once for each mode (`formal`, `input`, `narrative`, `hybrid`, `sketch`, `summary`). Results go into `output/<basename>/`. So if the input is `examples/cli-contract.md`, the outputs are `output/cli-contract/formal.md`, `output/cli-contract/narrative.md`, and so on.

On the first mode run for each file, the script also saves the AISP to `output/<basename>/<basename>.aisp`. This way you can see the intermediate representation that all the mode outputs were derived from.

Progress should be printed to the terminal as it goes, something like `[cli-contract] [formal] ...` so you can watch it work without staring at a blank screen.

The script should forward `--model`, `--provider`, and `--purify-model` to purify if they're given, so you can test different model configurations without editing the script.

The `output/` directory is gitignored. Results are local only — they're for eyeballing, not committing.
