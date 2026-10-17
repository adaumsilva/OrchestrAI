module.exports = async (t) => {
  const info = await t.js(`({ floors: state.floors.length, nodes: activeFloor().nodes.length })`);
  t.check('boots with one floor', info.floors === 1, info);
  t.check('starts with a terminal', info.nodes === 1, info);
};
