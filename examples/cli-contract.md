# CLI contract

The purify CLI takes a spec as input and produces a transformed version of it. The primary use case is piping: write a spec, run purify on it, get something back.

Input resolution: if a file path is given with `-f` or `--file`, read from that file. If a positional argument is given that looks like a path to an existing file, use that. If text is piped on stdin, read from stdin. If multiple of these are present, file flag takes priority over positional, positional takes priority over stdin. If nothing is provided, print usage and exit nonzero.

Output: by default write to stdout. If `--output` is given, write to that file instead. The output format depends on the mode.

Mode: controlled by `--mode`. Valid values are `formal`, `input`, `narrative`, `hybrid`, `sketch`, `summary`. Default is `formal`. If an unrecognized mode is given, exit with an error listing the valid modes.

Model and provider: `--model` sets the model name, `--provider` sets the provider. These override whatever is in config. The model used for the internal purify step (generating the AISP) can be set separately with `--purify-model`.

AISP saving: `--save-aisp <path>` writes the intermediate AISP to the given path in addition to producing the normal output.

Exit codes: 0 on success, 1 on usage errors (bad flags, missing input), 2 on runtime errors (LLM failure, file not found). Errors go to stderr, not stdout.

There's a `--verbose` flag that prints progress information to stderr. Not sure exactly what it should show — at minimum what mode is being used and which model.
