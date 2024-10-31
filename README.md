<h1 align="center">Welcome to Creator-Hub-Operator 👋</h1>
<p>
  <img alt="Version" src="https://img.shields.io/badge/version-1.0-blue.svg?cacheSeconds=2592000" />
  <a href="#" target="_blank">
    <img alt="License: (MIT)" src="https://img.shields.io/badge/License-(MIT)-yellow.svg" />
  </a>
</p>

> CreatorHub AVS provides a streamlined solution for managing and automating tasks in the creator ecosystem. This project utilizes Solidity, JavaScript, and other technologies to create a comprehensive toolkit for creators.

## Install

```sh
(yarn install)
```

## Usage

```sh
yarn start:anvil
```

## Run tests

```sh
# Setup .env file
cp .env.example .env
cp contracts/.env.example contracts/.env

# Updates dependencies if necessary and builds the contracts 
yarn build

# Deploy the EigenLayer contracts
yarn deploy:core

# Deploy the Hello World AVS contracts
yarn deploy:hello-world

# (Optional) Update ABIs
yarn extract:abis

# Start the Operator application
yarn start:operator

```

```sh
# Start the createNewTasks application 
yarn start:traffic
```

## Author

👤 **Irfan, Akbar**


## Show your support

Give a ⭐️ if this project helped you!

***
_This README was generated with ❤️ by [readme-md-generator](https://github.com/kefranabg/readme-md-generator)_


