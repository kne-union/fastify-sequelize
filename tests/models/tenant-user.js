module.exports = ({ DataTypes }) => {
  return {
    model: {
      name: DataTypes.STRING, tenantUserId: DataTypes.STRING
    }
  };
};
