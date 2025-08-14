import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  async preload() {
    // Здесь можно подключать внешние плагины, но rexUI добавим в PreloadScene
  }

  create() {
    this.scene.start('PreloadScene');
  }
}


