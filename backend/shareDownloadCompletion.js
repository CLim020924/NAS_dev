const whenSuccessfulResponseFinishes = (response, onSuccess) => {
  response.once('finish', () => {
    if (response.statusCode >= 200 && response.statusCode < 300) onSuccess();
  });
};

module.exports = { whenSuccessfulResponseFinishes };
