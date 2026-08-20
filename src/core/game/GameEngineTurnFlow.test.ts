import { describe, expect, it } from 'vitest';
import { TorusTopology } from '../topology/TorusTopology';
import {
  GameEngine,
  type AcceptedPassResult,
  type AcceptedPlaceStoneResult,
  type PassResult,
  type PlaceStoneResult,
} from './GameEngine';

const expectAcceptedMove = (result: PlaceStoneResult): AcceptedPlaceStoneResult => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected accepted move, got ${result.reason}`);
  return result;
};

const expectAcceptedPass = (result: PassResult): AcceptedPassResult => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected accepted pass, got ${result.reason}`);
  return result;
};

describe('GameEngine turn flow and pass handling', () => {
  const create = () => new GameEngine(new TorusTopology(9));

  it('starts every new game with black to move and zero actions or passes', () => {
    const state = create().createInitialState();

    expect(state.currentPlayer).toBe('black');
    expect(state.moveNumber).toBe(0);
    expect(state.consecutivePasses).toBe(0);
    expect(state.phase).toBe('playing');
  });

  it('alternates players after every accepted stone move and increments move number', () => {
    const engine = create();
    const initial = engine.createInitialState();
    const blackMove = expectAcceptedMove(engine.placeStone(initial, '4,4', 'black'));
    const whiteMove = expectAcceptedMove(engine.placeStone(blackMove.state, '5,4', 'white'));

    expect(blackMove.state.currentPlayer).toBe('white');
    expect(blackMove.state.moveNumber).toBe(1);
    expect(whiteMove.state.currentPlayer).toBe('black');
    expect(whiteMove.state.moveNumber).toBe(2);
  });

  it('does not allow the caller to bypass currentPlayer', () => {
    const engine = create();
    const initial = engine.createInitialState();
    const rejected = engine.placeStone(initial, '4,4', 'white');

    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error('Expected wrong-player rejection');
    expect(rejected.reason).toBe('wrong-player');
    expect(rejected.state).toBe(initial);
    expect(initial.currentPlayer).toBe('black');
    expect(initial.moveNumber).toBe(0);
  });

  it('does not change turn flow when a move is rejected', () => {
    const engine = create();
    const blackMove = expectAcceptedMove(
      engine.placeStone(engine.createInitialState(), '4,4', 'black'),
    );
    const rejected = engine.placeStone(blackMove.state, '4,4', 'white');

    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error('Expected occupied rejection');
    expect(rejected.reason).toBe('occupied');
    expect(rejected.state).toBe(blackMove.state);
    expect(rejected.state.currentPlayer).toBe('white');
    expect(rejected.state.moveNumber).toBe(1);
    expect(rejected.state.consecutivePasses).toBe(0);
  });

  it('treats one pass as a numbered action and hands the turn to the opponent', () => {
    const engine = create();
    const initial = engine.createInitialState();
    const pass = expectAcceptedPass(engine.pass(initial));

    expect(pass.passedBy).toBe('black');
    expect(pass.state.board).toBe(initial.board);
    expect(pass.state.currentPlayer).toBe('white');
    expect(pass.state.moveNumber).toBe(1);
    expect(pass.state.consecutivePasses).toBe(1);
    expect(pass.state.phase).toBe('playing');
  });

  it('resets consecutivePasses when a normal move follows one pass', () => {
    const engine = create();
    const firstPass = expectAcceptedPass(engine.pass(engine.createInitialState()));
    const whiteMove = expectAcceptedMove(engine.placeStone(firstPass.state, '4,4', 'white'));

    expect(whiteMove.state.board['4,4']).toBe('white');
    expect(whiteMove.state.currentPlayer).toBe('black');
    expect(whiteMove.state.moveNumber).toBe(2);
    expect(whiteMove.state.consecutivePasses).toBe(0);
    expect(whiteMove.state.phase).toBe('playing');
  });

  it('moves from playing to endgame readiness after two consecutive passes', () => {
    const engine = create();
    const firstPass = expectAcceptedPass(engine.pass(engine.createInitialState()));
    const secondPass = expectAcceptedPass(engine.pass(firstPass.state));

    expect(firstPass.passedBy).toBe('black');
    expect(secondPass.passedBy).toBe('white');
    expect(secondPass.state.currentPlayer).toBe('black');
    expect(secondPass.state.moveNumber).toBe(2);
    expect(secondPass.state.consecutivePasses).toBe(2);
    expect(secondPass.state.phase).toBe('endgame');
  });

  it('counts a pass in numbering between stone moves', () => {
    const engine = create();
    const blackMove = expectAcceptedMove(
      engine.placeStone(engine.createInitialState(), '3,3', 'black'),
    );
    const whitePass = expectAcceptedPass(engine.pass(blackMove.state));
    const blackMoveAfterPass = expectAcceptedMove(
      engine.placeStone(whitePass.state, '4,4', 'black'),
    );

    expect(blackMove.state.moveNumber).toBe(1);
    expect(whitePass.state.moveNumber).toBe(2);
    expect(blackMoveAfterPass.state.moveNumber).toBe(3);
    expect(blackMoveAfterPass.state.consecutivePasses).toBe(0);
  });

  it('does not accept more game actions after entering endgame readiness', () => {
    const engine = create();
    const firstPass = expectAcceptedPass(engine.pass(engine.createInitialState()));
    const endgame = expectAcceptedPass(engine.pass(firstPass.state)).state;

    const move = engine.placeStone(endgame, '4,4', 'black');
    const pass = engine.pass(endgame);

    expect(move.ok).toBe(false);
    if (move.ok) throw new Error('Expected not-playing move rejection');
    expect(move.reason).toBe('not-playing');
    expect(move.state).toBe(endgame);

    expect(pass.ok).toBe(false);
    if (pass.ok) throw new Error('Expected not-playing pass rejection');
    expect(pass.reason).toBe('not-playing');
    expect(pass.state).toBe(endgame);
  });
});
