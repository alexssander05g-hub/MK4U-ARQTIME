# Caixas bin cheias de ferragens (SketchUp)

Caixa bin aberta na frente (140 × 230 × 125 mm, L × P × A, frente com 55 mm)
em plástico escuro, com sete versões de recheio:

| Arquivo | Conteúdo |
|---------|----------|
| `bin_parafusos`         | ~110 parafusos 4×40 bicromatizados |
| `bin_pregos`            | ~170 pregos 17×27 |
| `bin_pacotes_de_pregos` | 9 cartelas blister com pregos (7 em pé, 2 deitadas) |
| `bin_arruelas`          | ~260 arruelas M6 |
| `bin_porcas`            | ~180 porcas M6 |
| `bin_buchas`            | ~130 buchas de nylon 6 mm |
| `bin_ferragens_mistas`  | parafusos + porcas + arruelas |
| `caixa_bin_vazia`       | só a caixa |

Como funciona: por baixo há um **"monte"** (superfície sólida na cor da
ferragem) que faz o volume, e por cima ficam **itens individuais leves**
(poucos polígonos) espalhados com rotação aleatória. Cada item é um
**componente instanciado**, então 170 pregos pesam o mesmo que 1 no arquivo.

## Como usar no SketchUp

**Script Ruby (recomendado):** copie `sketchup-ruby/bins_ferragens.rb` para
uma pasta sem acentos e, em *Janela › Console Ruby*:

```ruby
load "C:/blocos/bins_ferragens.rb"
```

Cria os componentes "Bin - parafusos", "Bin - pregos", … e "Caixa bin
vazia", em linha na origem. Dentro de cada bin há a caixa, o monte e os
itens, todos componentes separados. Para usar o recheio na **sua** caixa já
modelada: entre no componente, copie o "Monte" e os itens, e cole na sua
caixa (o recheio foi feito para um interior de 135 × 225 mm; escale se
precisar).

**DAE:** *Arquivo › Importar › COLLADA*. Os arquivos usam instâncias
(`instance_node`), que o SketchUp importa como componentes. Um arquivo por
bin e `todos_os_bins.dae` com todos.

**OBJ:** tudo "assado" (sem instâncias, mais pesado). Importe em milímetros.

## Ajustar

No topo de `gerar_potes.py`: `BIN` (medidas da caixa), `FILL_Z` (altura do
monte) e, em `build_scene()`, a quantidade de itens de cada bin.

```bash
python3 gerar_potes.py
```
