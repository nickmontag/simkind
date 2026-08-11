export interface CharacterRuntimeAdapter<World, Context, Input> {
  recordInputs(world: World, inputs: readonly Input[]): World;
  applyInputs(world: World, context: Context, inputs: readonly Input[]): World;
  expireRequests(world: World, context: Context): World;
  interactions(world: World, context: Context): World;
  cognition(world: World, context: Context): World;
}

export interface CharacterRuntime<World, Context, Input> {
  applyInputs(world: World, context: Context, inputs: readonly Input[]): World;
  advanceInteractions(world: World, context: Context): World;
  advanceCognition(world: World, context: Context): World;
}

export function createCharacterRuntime<World, Context, Input>(
  adapter: CharacterRuntimeAdapter<World, Context, Input>,
): CharacterRuntime<World, Context, Input> {
  return {
    applyInputs(world, context, inputs) {
      if (inputs.length > 0) {
        world = adapter.recordInputs(world, inputs);
        world = adapter.applyInputs(world, context, inputs);
      }
      return adapter.expireRequests(world, context);
    },
    advanceInteractions: adapter.interactions,
    advanceCognition: adapter.cognition,
  };
}
